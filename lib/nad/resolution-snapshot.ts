import { withRetries } from "../fetch-retry";
import { fetchNadChart, fetchNadHolders, fetchNadMarket, fetchNadTokenMetadata } from "./api";
import { snapshotFromMarketInfo, type NadTokenSnapshot } from "./evaluate-outcome";
import type { NadMarketConfig } from "./types";

export type NadSnapshotProgress = (message: string) => void;

const NAD_FETCH_ATTEMPTS = 3;

async function loadTokenMarketInfo(
  tokenAddress: string,
  onProgress?: NadSnapshotProgress,
): Promise<Record<string, unknown>> {
  return withRetries(
    async (attempt) => {
      onProgress?.(`nad api token ${tokenAddress.slice(0, 10)}… attempt ${attempt}/${NAD_FETCH_ATTEMPTS}`);
      try {
        const meta = await fetchNadTokenMetadata(tokenAddress);
        if (meta.market_info) return meta.market_info as Record<string, unknown>;
      } catch {
        // fall through to trade/market
      }
      const market = await fetchNadMarket(tokenAddress);
      return (market.market_info ?? {}) as Record<string, unknown>;
    },
    { attempts: NAD_FETCH_ATTEMPTS, delayMs: 2000, onRetry: ({ attempt, error }) => {
      const reason = error instanceof Error ? error.message : String(error);
      onProgress?.(`nad api retry ${attempt}/${NAD_FETCH_ATTEMPTS}: ${reason}`);
    } },
  );
}

async function loadMcapChart(
  tokenAddress: string,
  fromUnix: number,
  toUnix: number,
  onProgress?: NadSnapshotProgress,
): Promise<Awaited<ReturnType<typeof fetchNadChart>> | null> {
  const span = Math.max(toUnix - fromUnix, 3600);
  const countback = Math.min(2000, Math.ceil(span / 60) + 10);
  for (const chartType of ["market_cap_usd", "market_cap", "mcap_usd"]) {
    try {
      return await withRetries(
        async (attempt) => {
          onProgress?.(`nad chart ${chartType} attempt ${attempt}/${NAD_FETCH_ATTEMPTS}`);
          const chart = await fetchNadChart(tokenAddress, {
            from: fromUnix,
            to: toUnix,
            countback,
            resolution: "60",
            chartType,
          });
          if ((chart.t?.length ?? 0) === 0) throw new Error("empty chart");
          return chart;
        },
        { attempts: NAD_FETCH_ATTEMPTS, delayMs: 2000 },
      );
    } catch {
      // try next chart type
    }
  }
  return null;
}

/**
 * Fetch live Nad.fun data needed to evaluate `nadMarket` at resolution time.
 */
export async function fetchNadResolutionSnapshots(
  cfg: NadMarketConfig,
  onProgress?: NadSnapshotProgress,
): Promise<NadTokenSnapshot[]> {
  const now = Math.floor(Date.now() / 1000);
  const chartFrom = Math.max(0, cfg.stakeEndUnix - 24 * 3600);

  return Promise.all(
    cfg.tokens.map(async (token) => {
      const marketInfo = await loadTokenMarketInfo(token.address, onProgress);
      let holderCount: number | null = null;

      if (cfg.questionType === "holder_count_above") {
        try {
          const holders = await withRetries(() => fetchNadHolders(token.address), {
            attempts: NAD_FETCH_ATTEMPTS,
            delayMs: 2000,
          });
          holderCount =
            typeof holders.holder_count === "number"
              ? holders.holder_count
              : Array.isArray(holders.holders)
                ? holders.holders.length
                : null;
        } catch {
          // use market_info.holder_count via parseNadMarketStats
        }
      }

      let mcapChart = null;
      if (cfg.questionType === "mcap_threshold_first") {
        mcapChart = await loadMcapChart(token.address, chartFrom, Math.max(now, cfg.resolveAfterUnix), onProgress);
      }

      return snapshotFromMarketInfo(token, marketInfo, { mcapChart, holderCount });
    }),
  );
}

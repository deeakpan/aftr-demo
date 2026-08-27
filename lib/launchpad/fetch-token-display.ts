import type { NadLiveStats } from "@/lib/nad/market-stats";
import { parseNadMarketStats } from "@/lib/nad/market-stats";
import type { NadMarketConfig, NadTokenRef } from "@/lib/nad/types";
import type { PonsOnchainTokenResponse } from "@/lib/pons/types";

export type LaunchpadTokenDisplay = {
  token: NadTokenRef;
  /** Raw Nad-style market_info when available; otherwise null. */
  marketRaw: Record<string, unknown> | null;
  stats: NadLiveStats | null;
  source: "pons" | "nad" | null;
};

/** Adapted Pons configs set apiBaseUrl to ponsfamily.com. */
export function isPonsDisplayMarket(nadMarket: NadMarketConfig): boolean {
  return /pons/i.test(nadMarket.apiBaseUrl ?? "");
}

function ponsStatsToLive(stats: PonsOnchainTokenResponse["stats"]): NadLiveStats {
  return {
    priceUsd: stats.priceUsd,
    marketCapUsd: stats.marketCapUsd,
    holderCount: null,
    marketType: stats.isBonded ? "bonding" : "dex",
    isOnDex: !stats.isBonded,
  };
}

async function fetchPonsDisplay(token: NadTokenRef): Promise<LaunchpadTokenDisplay | null> {
  try {
    const res = await fetch(`/api/pons/token/${token.address}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as PonsOnchainTokenResponse;
    const merged: NadTokenRef = {
      ...token,
      symbol: json.token?.symbol || token.symbol,
      name: json.token?.name || token.name,
      imageUri: json.token?.imageUri || token.imageUri,
      isGraduated: true,
    };
    return {
      token: merged,
      marketRaw: null,
      stats: ponsStatsToLive(json.stats),
      source: "pons",
    };
  } catch {
    return null;
  }
}

async function fetchNadDisplay(token: NadTokenRef): Promise<LaunchpadTokenDisplay | null> {
  try {
    const res = await fetch(`/api/nad/token/${token.address}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { market_info?: Record<string, unknown> };
    const marketRaw = json.market_info ?? null;
    return {
      token,
      marketRaw,
      stats: parseNadMarketStats(marketRaw, { isGraduated: token.isGraduated }),
      source: "nad",
    };
  } catch {
    return null;
  }
}

/** Prefer Pons for Pons markets / graduated tokens; fall back across APIs. */
export async function fetchLaunchpadTokenDisplay(
  token: NadTokenRef,
  preferPons: boolean,
): Promise<LaunchpadTokenDisplay> {
  const order = preferPons || token.isGraduated
    ? [fetchPonsDisplay, fetchNadDisplay]
    : [fetchNadDisplay, fetchPonsDisplay];

  for (const fn of order) {
    const row = await fn(token);
    if (row?.stats) return row;
  }
  return { token, marketRaw: null, stats: null, source: null };
}

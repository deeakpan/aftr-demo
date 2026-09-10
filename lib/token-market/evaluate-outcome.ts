import { getTokenQuestionDef } from "./question-types";
import type { TokenMarketConfig, TokenPairSnapshot } from "./types";

function parseUsdThreshold(raw?: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid USD threshold: ${raw ?? "(missing)"}`);
  return n;
}

function requireStat(value: number | null, label: string, token: string): number {
  if (value == null || !Number.isFinite(value)) {
    throw new Error(`Missing ${label} for ${token}`);
  }
  return value;
}

export function evaluateTokenOutcome(
  cfg: TokenMarketConfig,
  snapshots: TokenPairSnapshot[],
  evaluatedAtUnix = Math.floor(Date.now() / 1000),
) {
  getTokenQuestionDef(cfg.questionType);
  switch (cfg.questionType) {
    case "mcap_usd_above": {
      const threshold = parseUsdThreshold(cfg.params?.thresholdUsd);
      const mcap = requireStat(snapshots[0]!.stats.marketCapUsd, "market cap USD", snapshots[0]!.pair.symbol);
      const yes = mcap >= threshold;
      return {
        outcomeIndex: yes ? 0 : 1,
        outcomeLabel: yes ? "Yes" : "No",
        reasoning: `Mcap $${mcap.toLocaleString()} vs threshold $${threshold.toLocaleString()} → ${yes ? "Yes" : "No"} (at ${evaluatedAtUnix})`,
      };
    }
    case "price_usd_above": {
      const threshold = parseUsdThreshold(cfg.params?.thresholdUsd);
      const price = requireStat(snapshots[0]!.stats.priceUsd, "price USD", snapshots[0]!.pair.symbol);
      const yes = price >= threshold;
      return {
        outcomeIndex: yes ? 0 : 1,
        outcomeLabel: yes ? "Yes" : "No",
        reasoning: `Price $${price} vs threshold $${threshold} → ${yes ? "Yes" : "No"} (at ${evaluatedAtUnix})`,
      };
    }
    case "mcap_highest": {
      let bestIdx = 0;
      let best = requireStat(snapshots[0]!.stats.marketCapUsd, "market cap", snapshots[0]!.pair.symbol);
      for (let i = 1; i < snapshots.length; i += 1) {
        const mcap = requireStat(snapshots[i]!.stats.marketCapUsd, "market cap", snapshots[i]!.pair.symbol);
        if (mcap > best) {
          best = mcap;
          bestIdx = i;
        }
      }
      const winner = snapshots[bestIdx]!;
      return {
        outcomeIndex: bestIdx,
        outcomeLabel: winner.pair.symbol.toUpperCase(),
        reasoning: `${winner.pair.symbol} highest mcap $${best.toLocaleString()} (at ${evaluatedAtUnix})`,
      };
    }
    default:
      throw new Error(`Unknown token question ${cfg.questionType}`);
  }
}

import { getPrismQuestionDef } from "./question-types";
import type { PrismAssetSnapshot, PrismMarketConfig } from "./types";

function parseUsdThreshold(raw?: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid USD threshold: ${raw ?? "(missing)"}`);
  return n;
}

function parseApyThreshold(raw?: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid APY threshold: ${raw ?? "(missing)"}`);
  return n;
}

function requireStat(value: number | null, label: string, token: string): number {
  if (value == null || !Number.isFinite(value)) {
    throw new Error(`Missing ${label} for ${token}`);
  }
  return value;
}

export function evaluatePrismOutcome(
  cfg: PrismMarketConfig,
  snapshots: PrismAssetSnapshot[],
  evaluatedAtUnix = Math.floor(Date.now() / 1000),
) {
  getPrismQuestionDef(cfg.questionType);
  if (snapshots.length === 0) throw new Error("No Prism snapshots");

  switch (cfg.questionType) {
    case "price_usd_above": {
      const threshold = parseUsdThreshold(cfg.params?.thresholdUsd);
      const price = requireStat(snapshots[0]!.stats.priceUsd, "price USD", snapshots[0]!.asset.symbol);
      const yes = price >= threshold;
      return {
        outcomeIndex: yes ? 0 : 1,
        outcomeLabel: yes ? "Yes" : "No",
        reasoning: `Prism price $${price} vs threshold $${threshold} → ${yes ? "Yes" : "No"} (at ${evaluatedAtUnix})`,
      };
    }
    case "mcap_usd_above": {
      const threshold = parseUsdThreshold(cfg.params?.thresholdUsd);
      const mcap = requireStat(snapshots[0]!.stats.marketCapUsd, "market cap USD", snapshots[0]!.asset.symbol);
      const yes = mcap >= threshold;
      return {
        outcomeIndex: yes ? 0 : 1,
        outcomeLabel: yes ? "Yes" : "No",
        reasoning: `Prism mcap $${mcap.toLocaleString()} vs threshold $${threshold.toLocaleString()} → ${yes ? "Yes" : "No"} (at ${evaluatedAtUnix})`,
      };
    }
    case "yield_apy_above": {
      const threshold = parseApyThreshold(cfg.params?.thresholdApyPct);
      const apy = requireStat(snapshots[0]!.stats.yieldApyPct, "APY %", snapshots[0]!.asset.symbol);
      const yes = apy >= threshold;
      return {
        outcomeIndex: yes ? 0 : 1,
        outcomeLabel: yes ? "Yes" : "No",
        reasoning: `Prism APY ${apy}% vs threshold ${threshold}% → ${yes ? "Yes" : "No"} (at ${evaluatedAtUnix})`,
      };
    }
    case "price_highest": {
      let bestIdx = 0;
      let best = requireStat(snapshots[0]!.stats.priceUsd, "price USD", snapshots[0]!.asset.symbol);
      for (let i = 1; i < snapshots.length; i += 1) {
        const price = requireStat(snapshots[i]!.stats.priceUsd, "price USD", snapshots[i]!.asset.symbol);
        if (price > best) {
          best = price;
          bestIdx = i;
        }
      }
      const winner = snapshots[bestIdx]!;
      return {
        outcomeIndex: bestIdx,
        outcomeLabel: winner.asset.symbol.toUpperCase(),
        reasoning: `${winner.asset.symbol} highest Prism price $${best} (at ${evaluatedAtUnix})`,
      };
    }
    case "mcap_highest": {
      let bestIdx = 0;
      let best = requireStat(snapshots[0]!.stats.marketCapUsd, "market cap", snapshots[0]!.asset.symbol);
      for (let i = 1; i < snapshots.length; i += 1) {
        const mcap = requireStat(snapshots[i]!.stats.marketCapUsd, "market cap", snapshots[i]!.asset.symbol);
        if (mcap > best) {
          best = mcap;
          bestIdx = i;
        }
      }
      const winner = snapshots[bestIdx]!;
      return {
        outcomeIndex: bestIdx,
        outcomeLabel: winner.asset.symbol.toUpperCase(),
        reasoning: `${winner.asset.symbol} highest Prism mcap $${best.toLocaleString()} (at ${evaluatedAtUnix})`,
      };
    }
    case "yield_highest": {
      let bestIdx = 0;
      let best = requireStat(snapshots[0]!.stats.yieldApyPct, "APY %", snapshots[0]!.asset.symbol);
      for (let i = 1; i < snapshots.length; i += 1) {
        const apy = requireStat(snapshots[i]!.stats.yieldApyPct, "APY %", snapshots[i]!.asset.symbol);
        if (apy > best) {
          best = apy;
          bestIdx = i;
        }
      }
      const winner = snapshots[bestIdx]!;
      return {
        outcomeIndex: bestIdx,
        outcomeLabel: winner.asset.symbol.toUpperCase(),
        reasoning: `${winner.asset.symbol} highest Prism APY ${best}% (at ${evaluatedAtUnix})`,
      };
    }
    default:
      throw new Error(`Unknown Prism question ${cfg.questionType}`);
  }
}

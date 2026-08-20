import { getPonsQuestionDef } from "./question-types";
import type { PonsMarketConfig, PonsTokenSnapshot } from "./types";

export type PonsEvaluationResult = {
  outcomeIndex: number;
  outcomeLabel: string;
  evidence: {
    questionType: PonsMarketConfig["questionType"];
    evaluatedAtUnix: number;
    snapshots: PonsTokenSnapshot[];
    reasoning: string;
  };
};

function parseUsdThreshold(raw?: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid USD threshold: ${raw ?? "(missing)"}`);
  return n;
}

function requireStat(value: number | null, label: string, token: string): number {
  if (value == null || !Number.isFinite(value)) {
    throw new Error(`Missing ${label} for token ${token}`);
  }
  return value;
}

export function evaluatePonsOutcome(
  cfg: PonsMarketConfig,
  snapshots: PonsTokenSnapshot[],
  evaluatedAtUnix = Math.floor(Date.now() / 1000),
): PonsEvaluationResult {
  getPonsQuestionDef(cfg.questionType);

  switch (cfg.questionType) {
    case "mcap_usd_above": {
      const threshold = parseUsdThreshold(cfg.params?.thresholdUsd);
      const mcap = requireStat(snapshots[0]!.stats.marketCapUsd, "market cap USD", snapshots[0]!.address);
      const yes = mcap >= threshold;
      return {
        outcomeIndex: yes ? 0 : 1,
        outcomeLabel: yes ? "Yes" : "No",
        evidence: {
          questionType: cfg.questionType,
          evaluatedAtUnix,
          snapshots,
          reasoning: `Mcap $${mcap.toLocaleString()} vs threshold $${threshold.toLocaleString()} → ${yes ? "Yes" : "No"}`,
        },
      };
    }
    case "price_usd_above": {
      const threshold = parseUsdThreshold(cfg.params?.thresholdUsd);
      const price = requireStat(snapshots[0]!.stats.priceUsd, "price USD", snapshots[0]!.address);
      const yes = price >= threshold;
      return {
        outcomeIndex: yes ? 0 : 1,
        outcomeLabel: yes ? "Yes" : "No",
        evidence: {
          questionType: cfg.questionType,
          evaluatedAtUnix,
          snapshots,
          reasoning: `Price $${price} vs threshold $${threshold} → ${yes ? "Yes" : "No"}`,
        },
      };
    }
    case "mcap_highest": {
      let bestIdx = 0;
      let best = requireStat(snapshots[0]!.stats.marketCapUsd, "market cap", snapshots[0]!.address);
      for (let i = 1; i < snapshots.length; i += 1) {
        const mcap = requireStat(snapshots[i]!.stats.marketCapUsd, "market cap", snapshots[i]!.address);
        if (mcap > best) {
          best = mcap;
          bestIdx = i;
        }
      }
      const winner = snapshots[bestIdx]!;
      return {
        outcomeIndex: bestIdx,
        outcomeLabel: winner.symbol.toUpperCase(),
        evidence: {
          questionType: cfg.questionType,
          evaluatedAtUnix,
          snapshots,
          reasoning: `Highest mcap: ${winner.symbol} ($${best.toLocaleString()})`,
        },
      };
    }
    default:
      throw new Error(`Unsupported Pons question type`);
  }
}

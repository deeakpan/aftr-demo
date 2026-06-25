import type { NadChartResponse } from "./api";
import { getQuestionDef } from "./question-types";
import { parseNadMarketStats, type NadLiveStats } from "./market-stats";
import type { NadMarketConfig } from "./types";

export type NadTokenSnapshot = {
  address: string;
  symbol: string;
  stats: NadLiveStats;
  /** Mcap USD history for `mcap_threshold_first` (chart_type market_cap_usd when available). */
  mcapChart?: NadChartResponse | null;
};

export type NadResolutionEvidence = {
  questionType: NadMarketConfig["questionType"];
  evaluatedAtUnix: number;
  snapshots: NadTokenSnapshot[];
  reasoning: string;
};

export type NadEvaluationResult = {
  outcomeIndex: number;
  outcomeLabel: string;
  evidence: NadResolutionEvidence;
};

function parseUsdThreshold(raw?: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid USD threshold: ${raw ?? "(missing)"}`);
  return n;
}

function parseHolderThreshold(raw?: number): number {
  if (raw == null || !Number.isFinite(raw) || raw < 0) {
    throw new Error(`Invalid holder threshold: ${raw ?? "(missing)"}`);
  }
  return Math.floor(raw);
}

function requireStat(value: number | null, label: string, token: string): number {
  if (value == null || !Number.isFinite(value)) {
    throw new Error(`Missing ${label} for token ${token}`);
  }
  return value;
}

function chartSeriesValue(chart: NadChartResponse, i: number): number | null {
  const raw = chart.h?.[i] ?? chart.c?.[i];
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Earliest unix timestamp where chart series reaches threshold (inclusive). */
export function firstChartCrossingUnix(
  chart: NadChartResponse,
  threshold: number,
  beforeUnix: number,
): number | null {
  const len = chart.t?.length ?? 0;
  let best: number | null = null;
  for (let i = 0; i < len; i += 1) {
    const ts = chart.t[i];
    if (ts == null || ts > beforeUnix) continue;
    const val = chartSeriesValue(chart, i);
    if (val == null || val < threshold) continue;
    if (best == null || ts < best) best = ts;
  }
  return best;
}

function evaluateBinaryYes(
  cfg: NadMarketConfig,
  predicate: (snap: NadTokenSnapshot) => boolean,
  detail: string,
  snapshots: NadTokenSnapshot[],
  evaluatedAtUnix: number,
): NadEvaluationResult {
  const yes = predicate(snapshots[0]!);
  const outcomeIndex = yes ? 0 : 1;
  const outcomeLabel = yes ? "Yes" : "No";
  return {
    outcomeIndex,
    outcomeLabel,
    evidence: {
      questionType: cfg.questionType,
      evaluatedAtUnix,
      snapshots,
      reasoning: `${detail} → ${outcomeLabel}`,
    },
  };
}

function evaluateMcapHighest(cfg: NadMarketConfig, snapshots: NadTokenSnapshot[], evaluatedAtUnix: number): NadEvaluationResult {
  let bestIdx = 0;
  let bestMcap = requireStat(snapshots[0]!.stats.marketCapUsd, "market cap", snapshots[0]!.address);

  for (let i = 1; i < snapshots.length; i += 1) {
    const mcap = requireStat(snapshots[i]!.stats.marketCapUsd, "market cap", snapshots[i]!.address);
    if (mcap > bestMcap) {
      bestMcap = mcap;
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
      reasoning: `Highest mcap at resolve: ${winner.symbol} (${bestMcap})`,
    },
  };
}

function evaluateMcapThresholdFirst(
  cfg: NadMarketConfig,
  snapshots: NadTokenSnapshot[],
  evaluatedAtUnix: number,
): NadEvaluationResult {
  const def = getQuestionDef("mcap_threshold_first");
  const threshold = parseUsdThreshold(cfg.params?.thresholdUsd);
  const resolveAfter = cfg.resolveAfterUnix;

  const crossings: { tokenIndex: number; crossedAt: number }[] = [];

  for (let i = 0; i < snapshots.length; i += 1) {
    const snap = snapshots[i]!;
    const mcapNow = snap.stats.marketCapUsd;

    let crossedAt: number | null = null;
    if (snap.mcapChart && (snap.mcapChart.t?.length ?? 0) > 0) {
      crossedAt = firstChartCrossingUnix(snap.mcapChart, threshold, resolveAfter);
    }

    if (crossedAt == null && mcapNow != null && mcapNow >= threshold) {
      crossedAt = resolveAfter;
    }

    if (crossedAt != null) {
      crossings.push({ tokenIndex: i, crossedAt });
    }
  }

  const neitherIndex = snapshots.length;
  const neitherLabel = def.includesNeither ? "Neither" : `Outcome ${neitherIndex}`;

  if (crossings.length === 0) {
    return {
      outcomeIndex: neitherIndex,
      outcomeLabel: neitherLabel,
      evidence: {
        questionType: cfg.questionType,
        evaluatedAtUnix,
        snapshots,
        reasoning: `No token reached $${threshold} mcap by resolve time → ${neitherLabel}`,
      },
    };
  }

  crossings.sort((a, b) => a.crossedAt - b.crossedAt || a.tokenIndex - b.tokenIndex);
  const winner = crossings[0]!;
  const snap = snapshots[winner.tokenIndex]!;

  return {
    outcomeIndex: winner.tokenIndex,
    outcomeLabel: snap.symbol.toUpperCase(),
    evidence: {
      questionType: cfg.questionType,
      evaluatedAtUnix,
      snapshots,
      reasoning: `${snap.symbol} first reached $${threshold} mcap at unix ${winner.crossedAt}`,
    },
  };
}

/**
 * Map Nad.fun API snapshots + IPFS `nadMarket` config → on-chain outcome index.
 */
export function evaluateNadOutcome(
  cfg: NadMarketConfig,
  snapshots: NadTokenSnapshot[],
  evaluatedAtUnix = Math.floor(Date.now() / 1000),
): NadEvaluationResult {
  if (snapshots.length !== cfg.tokens.length) {
    throw new Error(`Expected ${cfg.tokens.length} token snapshots, got ${snapshots.length}`);
  }

  switch (cfg.questionType) {
    case "mcap_usd_above": {
      const threshold = parseUsdThreshold(cfg.params?.thresholdUsd);
      const mcap = requireStat(snapshots[0]!.stats.marketCapUsd, "market cap", snapshots[0]!.address);
      return evaluateBinaryYes(
        cfg,
        () => mcap >= threshold,
        `mcap ${mcap} vs threshold ${threshold}`,
        snapshots,
        evaluatedAtUnix,
      );
    }
    case "price_usd_above": {
      const threshold = parseUsdThreshold(cfg.params?.thresholdUsd);
      const price = requireStat(snapshots[0]!.stats.priceUsd, "price", snapshots[0]!.address);
      return evaluateBinaryYes(
        cfg,
        () => price >= threshold,
        `price ${price} vs threshold ${threshold}`,
        snapshots,
        evaluatedAtUnix,
      );
    }
    case "holder_count_above": {
      const threshold = parseHolderThreshold(cfg.params?.holderCount);
      const holders = requireStat(snapshots[0]!.stats.holderCount, "holder count", snapshots[0]!.address);
      return evaluateBinaryYes(
        cfg,
        () => holders >= threshold,
        `holders ${holders} vs threshold ${threshold}`,
        snapshots,
        evaluatedAtUnix,
      );
    }
    case "mcap_highest":
      return evaluateMcapHighest(cfg, snapshots, evaluatedAtUnix);
    case "mcap_threshold_first":
      return evaluateMcapThresholdFirst(cfg, snapshots, evaluatedAtUnix);
    default:
      throw new Error(`Unsupported Nad question type: ${(cfg as NadMarketConfig).questionType}`);
  }
}

/** Build token snapshots from raw Nad API responses. */
export function snapshotFromMarketInfo(
  token: NadMarketConfig["tokens"][number],
  marketInfo: Record<string, unknown> | null | undefined,
  extras?: { mcapChart?: NadChartResponse | null; holderCount?: number | null },
): NadTokenSnapshot {
  const stats = parseNadMarketStats(marketInfo, { isGraduated: token.isGraduated });
  if (extras?.holderCount != null && stats.holderCount == null) {
    stats.holderCount = extras.holderCount;
  }
  return {
    address: token.address,
    symbol: token.symbol,
    stats,
    mcapChart: extras?.mcapChart ?? null,
  };
}

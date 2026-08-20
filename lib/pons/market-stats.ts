import type { PonsLiveStats } from "./types";

export function formatPonsPriceUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (value >= 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toExponential(2)}`;
}

export function formatPonsMcapUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatProgressPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function defaultUsdThreshold(stats: PonsLiveStats | null): string {
  const mcap = stats?.marketCapUsd;
  if (mcap != null && mcap > 0) {
    const target = Math.max(mcap * 1.25, mcap + 10_000);
    return String(Math.round(target));
  }
  return "100000";
}

export function defaultProgressThreshold(stats: PonsLiveStats | null): number {
  const p = stats?.graduationProgress;
  if (p != null && p > 0) return Math.min(99, Math.max(5, Math.ceil(p + 10)));
  return 50;
}

export function usdThresholdSliderRange(stats: PonsLiveStats | null): { min: number; max: number; step: number } {
  const mcap = stats?.marketCapUsd ?? 50_000;
  const min = Math.max(1_000, Math.floor(mcap * 0.25));
  const max = Math.max(min * 2, Math.ceil(mcap * 4));
  return { min, max, step: Math.max(1_000, Math.round(max / 200)) };
}

export function formatUsdThresholdValue(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function maxTokenMcap(stats: (PonsLiveStats | null)[]): number {
  return stats.reduce((best, s) => Math.max(best, s?.marketCapUsd ?? 0), 0);
}

export function maxTokenProgress(stats: (PonsLiveStats | null)[]): number {
  return stats.reduce((best, s) => Math.max(best, s?.graduationProgress ?? 0), 0);
}

/** Vs tokens must be within 10% progress of the leader (same guardrail as Nad mcap parity). */
export function validateProgressParity(stats: (PonsLiveStats | null)[]): string | null {
  const values = stats.map((s) => s?.graduationProgress).filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length < 2) return null;
  const max = Math.max(...values);
  if (max <= 0) return "Could not read graduation progress for parity check.";
  const min = Math.min(...values);
  if (min < max * 0.9) {
    return "All tokens must be within 10% graduation progress of the leading token.";
  }
  return null;
}

export function validateMcapParity(stats: (PonsLiveStats | null)[]): string | null {
  const values = stats.map((s) => s?.marketCapUsd).filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length < 2) return null;
  const max = Math.max(...values);
  if (max <= 0) return "Could not read market cap for parity check.";
  const min = Math.min(...values);
  if (min < max * 0.9) {
    return "All tokens must be within 10% market cap of the leading token.";
  }
  return null;
}

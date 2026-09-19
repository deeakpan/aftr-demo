import { formatUnits } from "viem";

/** Compact display for share counts: 1k, 1.2k, 10k, 20k, etc. */
export function formatCompactCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return v >= 10 ? `${Math.round(v)}M` : `${trimTrailingZero(v.toFixed(1))}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return v >= 10 ? `${Math.round(v)}k` : `${trimTrailingZero(v.toFixed(1))}k`;
  }
  if (n >= 100) return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function trimTrailingZero(s: string) {
  return s.replace(/\.0$/, "");
}

export function formatShareAmount(raw: bigint, decimals: number): string {
  const s = formatUnits(raw, decimals);
  const n = Number(s);
  if (!Number.isFinite(n)) return `${s} shares`;
  return `${formatCompactCount(n)} shares`;
}

/** Compact inline share label for outcome pills/rows; null when empty. */
export function formatCompactSharesInline(raw: bigint, decimals: number): string | null {
  const n = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(n) || n <= 0) return null;
  return formatCompactCount(n);
}

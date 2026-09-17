/** Display helper for market chance percentages. */
export function formatChancePct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  if (pct < 1) return "<1%";
  if (pct >= 99.5) return `${Math.round(pct)}%`;
  if (Number.isInteger(pct) || Math.abs(pct - Math.round(pct)) < 0.05) {
    return `${Math.round(pct)}%`;
  }
  return `${pct.toFixed(1)}%`;
}

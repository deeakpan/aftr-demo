/** Display helper for market chance percentages. */
export function formatChancePct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  if (pct >= 99.95) return "100%";
  // Keep one decimal so thin-liquidity odds don't collapse to a blank-looking 0%.
  if (pct < 10) return `${pct.toFixed(1)}%`;
  if (Math.abs(pct - Math.round(pct)) < 0.05) return `${Math.round(pct)}%`;
  return `${pct.toFixed(1)}%`;
}

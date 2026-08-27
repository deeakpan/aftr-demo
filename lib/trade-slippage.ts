/** Persisted default trade slippage (basis points). */

export const DEFAULT_SLIPPAGE_BPS = 200;
export const SLIPPAGE_STORAGE_KEY = "zedkr-trade-slippage-bps";
export const SLIPPAGE_MIN_BPS = 1;
export const SLIPPAGE_MAX_BPS = 5000;
export const SLIPPAGE_PRESETS_BPS = [50, 100, 200, 300, 500] as const;

export function clampSlippageBps(bps: number): number {
  if (!Number.isFinite(bps)) return DEFAULT_SLIPPAGE_BPS;
  return Math.min(SLIPPAGE_MAX_BPS, Math.max(SLIPPAGE_MIN_BPS, Math.round(bps)));
}

export function readDefaultSlippageBps(): number {
  if (typeof window === "undefined") return DEFAULT_SLIPPAGE_BPS;
  try {
    const raw = window.localStorage.getItem(SLIPPAGE_STORAGE_KEY);
    if (raw == null || raw === "") return DEFAULT_SLIPPAGE_BPS;
    return clampSlippageBps(Number(raw));
  } catch {
    return DEFAULT_SLIPPAGE_BPS;
  }
}

export function writeDefaultSlippageBps(bps: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SLIPPAGE_STORAGE_KEY, String(clampSlippageBps(bps)));
  } catch {
    // ignore quota / private mode
  }
}

/** e.g. 200 bps → "2" or "2.0" */
export function slippageBpsToInput(bps: number): string {
  const pct = clampSlippageBps(bps) / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/\.?0+$/, "");
}

/** Parse user % input → bps, or null if incomplete/invalid. */
export function slippageInputToBps(raw: string): number | null {
  const cleaned = raw.trim().replace(/%/g, "");
  if (!cleaned || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return clampSlippageBps(n * 100);
}

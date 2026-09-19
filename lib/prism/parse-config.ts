import type { PrismMarketConfig } from "./types";

export function parsePrismMarketFromMetadata(
  md: Record<string, unknown> | null | undefined,
): PrismMarketConfig | null {
  if (!md || typeof md !== "object") return null;
  const raw = md.prismMarket;
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as Partial<PrismMarketConfig>;
  if (cfg.launchpad !== "prism") return null;
  if (cfg.version !== 1) return null;
  if (!cfg.questionType || !cfg.mode || !Array.isArray(cfg.assets) || cfg.assets.length === 0) {
    return null;
  }
  if (!cfg.assets.every((a) => a && typeof a.slug === "string" && typeof a.symbol === "string")) {
    return null;
  }
  return cfg as PrismMarketConfig;
}

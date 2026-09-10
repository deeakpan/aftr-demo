import type { TokenMarketConfig } from "./types";

export function parseTokenMarketFromMetadata(
  md: Record<string, unknown> | null | undefined,
): TokenMarketConfig | null {
  const raw = md?.tokenMarket;
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as TokenMarketConfig;
  if (cfg.version !== 1 || cfg.kind !== "token-link" || !cfg.questionType || !Array.isArray(cfg.pairs)) {
    return null;
  }
  if (!["mcap_usd_above", "price_usd_above", "mcap_highest"].includes(cfg.questionType)) {
    return null;
  }
  return cfg;
}

import type { NadMarketConfig } from "./types";

export function parseNadMarketFromMetadata(
  md: Record<string, unknown> | null | undefined,
): NadMarketConfig | null {
  const raw = md?.nadMarket;
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as NadMarketConfig;
  if (cfg.version !== 1 || !cfg.questionType || !Array.isArray(cfg.tokens)) return null;
  return cfg;
}

export function isNadMarketMetadata(md: Record<string, unknown> | null | undefined): boolean {
  return parseNadMarketFromMetadata(md) !== null;
}

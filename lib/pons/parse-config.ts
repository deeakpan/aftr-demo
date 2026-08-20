import type { PonsMarketConfig } from "./types";
import { parseNadMarketFromMetadata } from "@/lib/nad/parse-config";

export function parsePonsMarketFromMetadata(
  md: Record<string, unknown> | null | undefined,
): PonsMarketConfig | null {
  const raw = md?.ponsMarket;
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as PonsMarketConfig;
  if (cfg.version !== 1 || cfg.launchpad !== "pons" || !cfg.questionType || !Array.isArray(cfg.tokens)) {
    return null;
  }
  if (!["mcap_usd_above", "price_usd_above", "mcap_highest"].includes(cfg.questionType)) {
    return null;
  }
  return cfg;
}

export function isPonsMarketMetadata(md: Record<string, unknown> | null | undefined): boolean {
  return parsePonsMarketFromMetadata(md) !== null;
}

/** Read Pons or legacy Nad launchpad block. */
export function parseLaunchpadMarketFromMetadata(
  md: Record<string, unknown> | null | undefined,
): PonsMarketConfig | import("@/lib/nad/types").NadMarketConfig | null {
  return parsePonsMarketFromMetadata(md) ?? parseNadMarketFromMetadata(md);
}

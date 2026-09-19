import type { NadMarketConfig, NadQuestionType } from "@/lib/nad/types";
import type { NadLiveStats } from "@/lib/nad/market-stats";
import { prismApiBaseUrl } from "./config";
import type { PrismLiveStats, PrismMarketConfig, PrismQuestionType } from "./types";

function mapQuestionType(q: PrismQuestionType): NadQuestionType {
  if (q === "yield_apy_above") return "price_usd_above";
  if (q === "yield_highest") return "price_highest";
  return q as NadQuestionType;
}

/** Map Prism metadata to Nad card shape for shared list/preview components. */
export function prismMarketForCardPreview(cfg: PrismMarketConfig): NadMarketConfig {
  return {
    version: 1,
    questionType: mapQuestionType(cfg.questionType),
    mode: cfg.mode,
    tokens: cfg.assets.map((a) => ({
      address: a.address || a.slug,
      symbol: a.symbol,
      name: a.name,
      imageUri: a.imageUri,
      isGraduated: true,
      sourceUrl: `${cfg.apiBaseUrl || prismApiBaseUrl()}/assets/${a.slug}`,
      source: "dexscreener",
    })),
    params: {
      thresholdUsd: cfg.params?.thresholdUsd ?? cfg.params?.thresholdApyPct,
    },
    apiBaseUrl: cfg.apiBaseUrl || prismApiBaseUrl(),
    resolveAfterUnix: cfg.resolveAfterUnix,
    stakeEndUnix: cfg.stakeEndUnix,
    resolutionEndpoints: [],
    cardBackgroundSeed: cfg.cardBackgroundSeed,
    duplicateKey: cfg.duplicateKey,
  };
}

export function prismStatsForCardPreview(stats: PrismLiveStats | null | undefined): NadLiveStats | null {
  if (!stats) return null;
  return {
    priceUsd: stats.priceUsd,
    marketCapUsd: stats.marketCapUsd ?? stats.yieldApyPct,
    holderCount: null,
    marketType: "dex",
    isOnDex: true,
  };
}

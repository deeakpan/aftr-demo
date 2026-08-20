import type { NadMarketConfig, NadQuestionType } from "@/lib/nad/types";
import type { NadLiveStats } from "@/lib/nad/market-stats";
import type { PonsMarketConfig } from "./types";
import type { PonsLiveStats } from "./types";

function mapQuestionType(q: PonsMarketConfig["questionType"]): NadQuestionType {
  return q as NadQuestionType;
}

/** Map Pons metadata to Nad card shape for shared list/preview components. */
export function ponsMarketForCardPreview(cfg: PonsMarketConfig): NadMarketConfig {
  return {
    version: 1,
    questionType: mapQuestionType(cfg.questionType),
    mode: cfg.mode,
    tokens: cfg.tokens.map((t) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      imageUri: t.imageUri,
      isGraduated: true,
    })),
    params: cfg.params,
    apiBaseUrl: "https://ponsfamily.com",
    resolveAfterUnix: cfg.resolveAfterUnix,
    stakeEndUnix: cfg.stakeEndUnix,
    resolutionEndpoints: [],
    cardBackgroundSeed: cfg.cardBackgroundSeed,
    duplicateKey: cfg.duplicateKey,
  };
}

export function ponsStatsForCardPreview(stats: PonsLiveStats | null | undefined): NadLiveStats | null {
  if (!stats) return null;
  return {
    priceUsd: stats.priceUsd,
    marketCapUsd: stats.marketCapUsd,
    holderCount: null,
    marketType: "dex",
    isOnDex: true,
  };
}

import type { NadMarketConfig, NadQuestionType } from "@/lib/nad/types";
import type { NadLiveStats } from "@/lib/nad/market-stats";
import type { TokenLiveStats, TokenMarketConfig } from "./types";

export function tokenMarketForCardPreview(cfg: TokenMarketConfig): NadMarketConfig {
  return {
    version: 1,
    questionType: cfg.questionType as NadQuestionType,
    mode: cfg.mode,
    tokens: cfg.pairs.map((t) => ({
      address: t.tokenAddress,
      symbol: t.symbol,
      name: t.name,
      imageUri: t.imageUri,
      isGraduated: true,
      sourceUrl: t.sourceUrl,
      source: t.source,
    })),
    params: cfg.params,
    apiBaseUrl: cfg.pairs[0]?.sourceUrl ?? "",
    resolveAfterUnix: cfg.resolveAfterUnix,
    stakeEndUnix: cfg.stakeEndUnix,
    resolutionEndpoints: [],
    cardBackgroundSeed: cfg.cardBackgroundSeed,
    duplicateKey: cfg.duplicateKey,
  };
}

export function tokenStatsForCardPreview(stats: TokenLiveStats | null | undefined): NadLiveStats | null {
  if (!stats) return null;
  return {
    priceUsd: stats.priceUsd,
    marketCapUsd: stats.marketCapUsd,
    holderCount: null,
    marketType: "dex",
    isOnDex: true,
  };
}

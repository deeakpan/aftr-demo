export type TokenQuestionType = "mcap_usd_above" | "price_usd_above" | "mcap_highest" | "price_highest";
export type TokenPairSource = "dexscreener" | "geckoterminal";

export type TokenPairRef = {
  source: TokenPairSource;
  sourceUrl: string;
  chainSlug: string;
  pairAddress: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  imageUri: string;
  quoteSymbol: string;
  quoteAddress: string;
};

export type TokenLiveStats = {
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  /** 24h volume in USD when the source provides it. */
  volumeUsd24h?: number | null;
};

export type TokenMarketConfig = {
  version: 1;
  kind: "token-link";
  questionType: TokenQuestionType;
  mode: "binary" | "comparison";
  pairs: TokenPairRef[];
  params?: { thresholdUsd?: string };
  resolveAfterUnix: number;
  stakeEndUnix: number;
  cardBackgroundSeed: string;
  duplicateKey: string;
};

export type TokenPairSnapshot = {
  pair: TokenPairRef;
  stats: TokenLiveStats;
};

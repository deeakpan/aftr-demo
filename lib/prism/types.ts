/** Prism RWA market question types — resolved from prismassets.shop catalogue API. */
export type PrismQuestionType =
  | "price_usd_above"
  | "mcap_usd_above"
  | "yield_apy_above"
  | "price_highest"
  | "mcap_highest"
  | "yield_highest";

export type PrismAssetRef = {
  slug: string;
  symbol: string;
  name: string;
  category: string;
  imageUri: string;
  /** Primary chain contract when Prism publishes one. */
  address?: string;
  chain?: string;
};

export type PrismMarketParams = {
  thresholdUsd?: string;
  /** For yield questions — APY percent, e.g. "4.25". */
  thresholdApyPct?: string;
};

/** Stored in IPFS market metadata — resolution + UI source of truth. */
export type PrismMarketConfig = {
  version: 1;
  launchpad: "prism";
  questionType: PrismQuestionType;
  mode: "binary" | "comparison";
  assets: PrismAssetRef[];
  params?: PrismMarketParams;
  apiBaseUrl: string;
  resolveAfterUnix: number;
  stakeEndUnix: number;
  cardBackgroundSeed: string;
  duplicateKey: string;
};

export type PrismLiveStats = {
  priceUsd: number | null;
  marketCapUsd: number | null;
  yieldApyPct: number | null;
  change24hPct: number | null;
  grade?: string | null;
};

export type PrismAssetSnapshot = {
  asset: PrismAssetRef;
  stats: PrismLiveStats;
};

/** Catalogue row from Prism REST `/api/v1/assets`. */
export type PrismCatalogueAsset = {
  slug: string;
  symbol: string;
  name: string;
  category: string;
  subcategory?: string;
  tagline?: string;
  priceUsd?: number | null;
  marketCapUsd?: number | null;
  yieldApyPct?: number | null;
  change24hPct?: number | null;
  change30dPct?: number | null;
  deployments?: Array<{ chain: string; address: string | null; isPrimary?: boolean }>;
  verification?: { status?: string };
  livePriceAsOf?: string | null;
};

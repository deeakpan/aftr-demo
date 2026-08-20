/** Pons V2 graduated-token market question types — resolved from Uniswap v4 + Chainlink. */
export type PonsQuestionType = "mcap_usd_above" | "price_usd_above" | "mcap_highest";

export type PonsTokenRef = {
  address: string;
  symbol: string;
  name: string;
  imageUri: string;
  curveAddress: string;
  pairToken: string;
  poolId?: string;
  /** False once graduated to Uniswap v4. */
  isBonded: boolean;
};

export type PonsMarketParams = {
  thresholdUsd?: string;
};

/** Stored in IPFS market metadata — resolution + UI source of truth. */
export type PonsMarketConfig = {
  version: 1;
  launchpad: "pons";
  questionType: PonsQuestionType;
  mode: "binary" | "comparison";
  tokens: PonsTokenRef[];
  params?: PonsMarketParams;
  chainId: number;
  resolveAfterUnix: number;
  stakeEndUnix: number;
  cardBackgroundSeed: string;
  duplicateKey: string;
};

export type PonsLiveStats = {
  priceUsd: number | null;
  marketCapUsd: number | null;
  graduationProgress: number | null;
  liquidityEth: number | null;
  quoteSymbol: string;
  pairToken: string;
  isBonded: boolean;
};

export type PonsTokenSnapshot = {
  address: string;
  symbol: string;
  stats: PonsLiveStats;
};

export type PonsOnchainTokenResponse = {
  token: PonsTokenRef;
  stats: PonsLiveStats;
  description: string;
};

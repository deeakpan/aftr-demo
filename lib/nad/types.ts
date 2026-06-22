/** Nad.fun market question types — metadata drives resolution API/subgraph usage. */
export type NadQuestionType =
  | "graduate_by_date"
  | "mcap_usd_above"
  | "price_usd_above"
  | "holder_count_above"
  | "graduate_first"
  | "mcap_highest"
  | "mcap_threshold_first";

export type NadTokenRef = {
  address: string;
  symbol: string;
  name: string;
  imageUri: string;
  isGraduated?: boolean;
};

export type NadResolutionEndpoint = {
  purpose:
    | "token_info"
    | "token_metadata"
    | "market_snapshot"
    | "chart"
    | "metrics"
    | "swap_history"
    | "holders"
    | "subgraph_graduate";
  method: "GET";
  path: string;
  description: string;
};

export type NadMarketParams = {
  thresholdUsd?: string;
  holderCount?: number;
};

/** Stored in IPFS market metadata — resolution + UI source of truth. */
export type NadMarketConfig = {
  version: 1;
  questionType: NadQuestionType;
  mode: "binary" | "comparison";
  tokens: NadTokenRef[];
  params?: NadMarketParams;
  apiBaseUrl: string;
  resolveAfterUnix: number;
  stakeEndUnix: number;
  resolutionEndpoints: NadResolutionEndpoint[];
  cardBackgroundSeed: string;
  duplicateKey: string;
};

export type NadTokenInfo = {
  token_id: string;
  name: string;
  symbol: string;
  image_uri: string;
  description: string | null;
  is_graduated: boolean;
  created_at: number;
  version: string;
};

export type NadMarketInfo = {
  market_type: string;
  token_id: string;
  quote_id: string;
  price_usd: string;
  price: string;
  token_price?: string;
  reserve_quote: string;
  reserve_token: string;
  total_supply?: string;
  market_cap_usd?: string;
  market_cap?: string;
  volume: string;
  holder_count: number;
  ath_price_usd: string;
};

export type NadTokenMetadataResponse = {
  token_info: NadTokenInfo;
  market_info?: NadMarketInfo;
};

import deployment from "@/lib/deployment";

export type ChainlinkFeedAsset = {
  label: string;
  asset: string;
  logo?: string;
  address: string;
  decimals?: number;
  /** Optional ERC-20 on Robinhood Chain (e.g. tokenized stock used as Pons pair). */
  tokenAddress?: string;
};

/** Price feeds from deployment JSON — extensible list for PRICE markets + Pons quote USD conversion. */
export function chainlinkFeeds(): ChainlinkFeedAsset[] {
  const ext = deployment.external as { chainlinkFeeds?: ChainlinkFeedAsset[] } | undefined;
  return ext?.chainlinkFeeds ?? [];
}

export function chainlinkFeedByAsset(asset: string): ChainlinkFeedAsset | undefined {
  const key = asset.trim().toUpperCase();
  return chainlinkFeeds().find((f) => f.asset.toUpperCase() === key);
}

export function chainlinkFeedByTokenAddress(tokenAddress: string): ChainlinkFeedAsset | undefined {
  const lower = tokenAddress.toLowerCase();
  return chainlinkFeeds().find((f) => f.tokenAddress?.toLowerCase() === lower);
}

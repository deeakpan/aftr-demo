import {
  assetImageUri,
  catalogueAssetToLiveStats,
  fetchPrismAsset,
  primaryDeployment,
} from "./api";
import type { PrismAssetRef, PrismAssetSnapshot, PrismMarketConfig } from "./types";

export async function fetchPrismResolutionSnapshots(
  cfg: PrismMarketConfig,
): Promise<PrismAssetSnapshot[]> {
  const out: PrismAssetSnapshot[] = [];
  for (const asset of cfg.assets) {
    const row = await fetchPrismAsset(asset.slug);
    const dep = primaryDeployment(row);
    const refreshed: PrismAssetRef = {
      ...asset,
      symbol: row.symbol || asset.symbol,
      name: row.name || asset.name,
      category: row.category || asset.category,
      imageUri: assetImageUri({ slug: row.slug || asset.slug }),
      address: dep.address ?? asset.address,
      chain: dep.chain ?? asset.chain,
    };
    out.push({
      asset: refreshed,
      stats: catalogueAssetToLiveStats(row),
    });
  }
  return out;
}

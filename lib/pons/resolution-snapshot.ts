import { fetchPonsToken } from "./onchain";
import type { PonsMarketConfig, PonsTokenSnapshot } from "./types";

export async function fetchPonsResolutionSnapshots(cfg: PonsMarketConfig): Promise<PonsTokenSnapshot[]> {
  const out: PonsTokenSnapshot[] = [];
  for (const ref of cfg.tokens) {
    const data = await fetchPonsToken(ref.address);
    out.push({
      address: ref.address,
      symbol: data.token.symbol,
      stats: data.stats,
    });
  }
  return out;
}

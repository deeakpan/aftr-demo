import { fetchTokenPairSnapshot } from "./fetch-pair";
import type { TokenMarketConfig, TokenPairSnapshot } from "./types";

export async function fetchTokenResolutionSnapshots(cfg: TokenMarketConfig): Promise<TokenPairSnapshot[]> {
  const out: TokenPairSnapshot[] = [];
  for (const pair of cfg.pairs) {
    const data = await fetchTokenPairSnapshot(pair);
    out.push({ pair: data.pair, stats: data.stats });
  }
  return out;
}

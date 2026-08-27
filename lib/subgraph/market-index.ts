import { querySubgraph } from "@/lib/subgraph/client";

const MARKETS_LIST_QUERY = `
  query MarketsList($first: Int!) {
    markets(
      first: $first
      orderBy: createdAtBlock
      orderDirection: desc
    ) {
      id
      kind
      mechanism
      state
      metadataURI
      stakeEndTimestamp
      resolveAfterTimestamp
      collateralToken
    }
  }
`;

export type SubgraphMarketIndex = {
  id: string;
  kind: number;
  mechanism?: string | null;
  state: number;
  metadataURI: string | null;
  stakeEndTimestamp: string;
  resolveAfterTimestamp: string;
  collateralToken: string;
};

type MarketsListResult = {
  markets: SubgraphMarketIndex[];
};

/** Markets with list fields from subgraph (newest first). */
export async function fetchMarketsFromSubgraph(
  first = 500,
): Promise<{ ok: true; markets: SubgraphMarketIndex[] } | { ok: false; markets: [] }> {
  const result = await querySubgraph<MarketsListResult>(MARKETS_LIST_QUERY, { first });
  if (!result.ok) return { ok: false, markets: [] };
  return { ok: true, markets: result.data.markets ?? [] };
}

/** @deprecated Use fetchMarketsFromSubgraph — address list only. */
export async function fetchMarketAddressesFromSubgraph(first = 500): Promise<`0x${string}`[]> {
  const result = await fetchMarketsFromSubgraph(first);
  return result.markets
    .map((m) => m.id.trim())
    .filter((id): id is `0x${string}` => /^0x[a-fA-F0-9]{40}$/.test(id));
}

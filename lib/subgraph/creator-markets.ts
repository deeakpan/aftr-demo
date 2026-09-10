import { querySubgraph } from "@/lib/subgraph/client";

const CREATOR_MARKETS_QUERY = `
  query CreatorMarkets($creator: String!, $first: Int!) {
    markets(
      first: $first
      orderBy: createdAtBlock
      orderDirection: desc
      where: { creator: $creator }
    ) {
      id
      kind
      mechanism
      state
      metadataURI
      stakeEndTimestamp
      resolveAfterTimestamp
      collateralToken
      creator
      createdAt
    }
  }
`;

export type SubgraphCreatorMarket = {
  id: string;
  kind: number;
  mechanism?: string | null;
  state: number;
  metadataURI: string | null;
  stakeEndTimestamp: string;
  resolveAfterTimestamp: string;
  collateralToken: string;
  creator: string;
  createdAt: string;
};

/** Markets created by a wallet (subgraph `creator` is lowercase address). */
export async function fetchMarketsByCreator(
  creator: string,
  first = 100,
): Promise<{ ok: true; markets: SubgraphCreatorMarket[] } | { ok: false; markets: []; reason: string }> {
  const id = creator.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(id)) {
    return { ok: false, markets: [], reason: "Invalid creator address" };
  }
  const result = await querySubgraph<{ markets: SubgraphCreatorMarket[] }>(CREATOR_MARKETS_QUERY, {
    creator: id,
    first,
  });
  if (!result.ok) return { ok: false, markets: [], reason: result.reason };
  return { ok: true, markets: result.data.markets ?? [] };
}

import { getAddress } from "viem";
import { getSubgraphUrl, querySubgraph } from "@/lib/subgraph/client";
import { KIND_EVENT, KIND_PONS, KIND_PRICE, STATE_OPEN, type DueMarket } from "./types";

const DUE_MARKETS_QUERY = `
  query DueMarkets($now: BigInt!, $first: Int!) {
    markets(
      where: {
        resolveAfterTimestamp_lte: $now
        kind_in: [0, 1, 2]
        state: 0
      }
      first: $first
      orderBy: resolveAfterTimestamp
      orderDirection: asc
    ) {
      id
      kind
      state
      metadataURI
      resolveAfterTimestamp
    }
  }
`;

const DUE_MARKETS_LEGACY_QUERY = `
  query DueMarketsLegacy($now: BigInt!, $first: Int!) {
    markets(
      where: {
        resolveAfterTimestamp_lte: $now
        kind_in: [0, 1, 2]
      }
      first: $first
      orderBy: resolveAfterTimestamp
      orderDirection: asc
    ) {
      id
      kind
      metadataURI
      resolveAfterTimestamp
    }
  }
`;

type SubgraphMarket = {
  id: string;
  kind: number | string;
  state?: number | string;
  metadataURI?: string | null;
  resolveAfterTimestamp: string;
};

function toDue(row: SubgraphMarket): DueMarket | null {
  const id = row.id?.trim();
  if (!id || !/^0x[a-fA-F0-9]{40}$/.test(id)) return null;
  const kind = Number(row.kind);
  if (kind !== KIND_PRICE && kind !== KIND_EVENT && kind !== KIND_PONS) return null;
  return {
    address: getAddress(id),
    kind,
    state: row.state == null ? STATE_OPEN : Number(row.state),
    resolveAfter: Number(row.resolveAfterTimestamp),
    metadataURI: row.metadataURI?.trim() || "",
    sources: ["subgraph"],
  };
}

export { getSubgraphUrl };

export async function fetchDueFromSubgraph(
  nowSec: number,
  first = 500,
): Promise<{ ok: true; markets: DueMarket[] } | { ok: false; markets: []; reason: string }> {
  const now = String(nowSec);
  const primary = await querySubgraph<{ markets: SubgraphMarket[] }>(DUE_MARKETS_QUERY, { now, first });
  if (primary.ok) {
    return { ok: true, markets: (primary.data.markets ?? []).map(toDue).filter(Boolean) as DueMarket[] };
  }

  if (!/state|metadataURI|field/i.test(primary.reason)) {
    return { ok: false, markets: [], reason: primary.reason };
  }

  const legacy = await querySubgraph<{ markets: SubgraphMarket[] }>(DUE_MARKETS_LEGACY_QUERY, { now, first });
  if (!legacy.ok) {
    return { ok: false, markets: [], reason: legacy.reason };
  }
  return { ok: true, markets: (legacy.data.markets ?? []).map(toDue).filter(Boolean) as DueMarket[] };
}

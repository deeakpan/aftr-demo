import { querySubgraph } from "@/lib/subgraph/client";

type TradeVolRow = {
  market: { id: string };
  collateralAmount: string;
  kind: string;
};

type TradesResult = {
  marketTrades: TradeVolRow[];
};

const PAGE = 1000;

/** Sum buy+sell collateral notional per market (redeem excluded). */
export async function fetchMarketVolumesFromSubgraph(
  marketIds: string[],
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const ids = [...new Set(marketIds.map((id) => id.toLowerCase()).filter(Boolean))];
  if (ids.length === 0) return out;

  // Chunk market id filters to keep queries small.
  const MARKET_CHUNK = 50;
  for (let i = 0; i < ids.length; i += MARKET_CHUNK) {
    const chunk = ids.slice(i, i + MARKET_CHUNK);
    let skip = 0;
    for (;;) {
      const result = await querySubgraph<TradesResult>(
        `query MarketVolumes($markets: [String!]!, $first: Int!, $skip: Int!) {
          marketTrades(
            where: { market_in: $markets, kind_in: ["buy", "sell"] }
            first: $first
            skip: $skip
            orderBy: timestamp
            orderDirection: asc
          ) {
            market { id }
            collateralAmount
            kind
          }
        }`,
        { markets: chunk, first: PAGE, skip },
      );
      if (!result.ok) break;
      const rows = result.data.marketTrades ?? [];
      for (const row of rows) {
        const mid = row.market?.id?.toLowerCase();
        if (!mid) continue;
        let amt = 0n;
        try {
          amt = BigInt(row.collateralAmount || "0");
        } catch {
          continue;
        }
        if (amt <= 0n) continue;
        out.set(mid, (out.get(mid) ?? 0n) + amt);
      }
      if (rows.length < PAGE) break;
      skip += PAGE;
      if (skip > 20_000) break;
    }
  }

  return out;
}

export async function fetchSingleMarketVolume(marketId: string): Promise<bigint> {
  const map = await fetchMarketVolumesFromSubgraph([marketId]);
  return map.get(marketId.toLowerCase()) ?? 0n;
}

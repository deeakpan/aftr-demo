import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSubgraphUrl, querySubgraph } from "@/lib/subgraph/client";

export const dynamic = "force-dynamic";

type TradeRow = {
  id: string;
  timestamp: string;
  collateralAmount: string;
  outcomeIndex: number;
  kind: string;
};

type TradesByMarketId = {
  marketTrades?: TradeRow[];
};

type TradesByMarketEntity = {
  market?: { trades: TradeRow[] } | null;
};

function normalizeTrades(rows: TradeRow[]) {
  return rows.map((t) => ({
    id: t.id,
    timestamp: Number(t.timestamp),
    collateralAmount: t.collateralAmount,
    outcomeIndex: Number(t.outcomeIndex),
    kind: t.kind,
  }));
}

export async function GET(req: NextRequest) {
  const market = req.nextUrl.searchParams.get("market")?.trim() ?? "";
  if (!market || !isAddress(market)) {
    return NextResponse.json({ error: "Invalid market address" }, { status: 400 });
  }

  const marketId = market.toLowerCase();

  const listQuery = await querySubgraph<TradesByMarketId>(
    `query MarketTrades($market: String!) {
      marketTrades(
        where: { market: $market }
        orderBy: timestamp
        orderDirection: asc
        first: 1000
      ) {
        id
        timestamp
        collateralAmount
        outcomeIndex
        kind
      }
    }`,
    { market: marketId },
  );

  if (listQuery.ok && (listQuery.data.marketTrades?.length ?? 0) > 0) {
    return NextResponse.json({
      trades: normalizeTrades(listQuery.data.marketTrades ?? []),
      unavailable: false,
    });
  }

  const entityQuery = await querySubgraph<TradesByMarketEntity>(
    `query MarketTradeList($id: ID!) {
      market(id: $id) {
        trades(first: 1000, orderBy: timestamp, orderDirection: asc) {
          id
          timestamp
          collateralAmount
          outcomeIndex
          kind
        }
      }
    }`,
    { id: marketId },
  );

  if (entityQuery.ok) {
    const rows = entityQuery.data.market?.trades ?? [];
    return NextResponse.json({
      trades: normalizeTrades(rows),
      unavailable: false,
    });
  }

  const reason =
    (!entityQuery.ok ? entityQuery.reason : undefined) ||
    (!listQuery.ok ? listQuery.reason : undefined) ||
    "Subgraph unavailable";
  return NextResponse.json({
    trades: [],
    unavailable: true,
    reason,
    subgraphUrl: getSubgraphUrl(),
  });
}

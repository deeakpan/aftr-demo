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
  trader?: { id: string } | null;
};

type TradesByMarketId = {
  marketTrades?: TradeRow[];
};

function normalizeTrades(rows: TradeRow[]) {
  return rows.map((t) => ({
    id: t.id,
    timestamp: Number(t.timestamp),
    collateralAmount: t.collateralAmount,
    outcomeIndex: Number(t.outcomeIndex),
    kind: t.kind,
    trader: (t.trader?.id ?? "").toLowerCase() || null,
  }));
}

export async function GET(req: NextRequest) {
  const market = req.nextUrl.searchParams.get("market")?.trim() ?? "";
  if (!market || !isAddress(market)) {
    return NextResponse.json({ error: "Invalid market address" }, { status: 400 });
  }

  const marketId = market.toLowerCase();
  const first = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("first") ?? "50") || 50));
  const orderDir =
    req.nextUrl.searchParams.get("order")?.trim().toLowerCase() === "asc" ? "asc" : "desc";

  const listQuery = await querySubgraph<TradesByMarketId>(
    `query MarketTrades($market: String!, $first: Int!) {
      marketTrades(
        where: { market: $market }
        orderBy: timestamp
        orderDirection: ${orderDir}
        first: $first
      ) {
        id
        timestamp
        collateralAmount
        outcomeIndex
        kind
        trader { id }
      }
    }`,
    { market: marketId, first },
  );

  if (listQuery.ok) {
    return NextResponse.json({
      trades: normalizeTrades(listQuery.data.marketTrades ?? []),
      unavailable: false,
    });
  }

  const legacy = await querySubgraph<TradesByMarketId>(
    `query MarketTradesLegacy($market: String!, $first: Int!) {
      marketTrades(
        where: { market: $market }
        orderBy: timestamp
        orderDirection: ${orderDir}
        first: $first
      ) {
        id
        timestamp
        collateralAmount
        outcomeIndex
        kind
      }
    }`,
    { market: marketId, first },
  );

  if (legacy.ok) {
    return NextResponse.json({
      trades: normalizeTrades(legacy.data.marketTrades ?? []),
      unavailable: false,
    });
  }

  return NextResponse.json({
    trades: [],
    unavailable: true,
    reason: listQuery.reason || "Subgraph unavailable",
    subgraphUrl: getSubgraphUrl(),
  });
}

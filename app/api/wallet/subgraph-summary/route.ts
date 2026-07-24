import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { querySubgraph } from "@/lib/subgraph/client";
import { formatSubgraphPnlUsd, formatSubgraphUsd } from "@/lib/subgraph/format-collateral-usd";

type GraphResponse = {
  data?: {
    trader?: {
      totalDeposited: string;
      totalRedeemed: string;
      positions?: Array<{ id: string }>;
    } | null;
    traderMarketPositions?: Array<{
      market: { id: string };
      collateralIn: string;
      collateralOut: string;
    }>;
  };
};

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const id = wallet.toLowerCase();
  const graph = await querySubgraph<NonNullable<GraphResponse["data"]>>(
    `query TraderSummary($id: ID!) {
      trader(id: $id) {
        totalDeposited
        totalRedeemed
        positions(first: 1000) { id }
      }
      traderMarketPositions(where: { trader: $id }, first: 1000) {
        market { id }
        collateralIn
        collateralOut
      }
    }`,
    { id },
  );

  if (!graph.ok) {
    return NextResponse.json({
      marketCount: 0,
      pnlUsd: "0.00",
      depositedUsd: "0.00",
      redeemedUsd: "0.00",
      unavailable: true,
      reason: graph.reason,
    });
  }

  const t = graph.data.trader;
  if (!t) {
    return NextResponse.json({
      marketCount: 0,
      pnlUsd: "0.00",
      depositedUsd: "0.00",
      redeemedUsd: "0.00",
    });
  }

  const marketCount = t.positions?.length ?? 0;
  const deposited = BigInt(t.totalDeposited || "0");
  const redeemed = BigInt(t.totalRedeemed || "0");
  const pnl = redeemed - deposited;
  const perMarket = graph.data.traderMarketPositions ?? [];
  const settledEvaluable = perMarket.filter((p) => BigInt(p.collateralIn || "0") > BigInt(0));
  const wins = settledEvaluable.filter((p) => BigInt(p.collateralOut || "0") > BigInt(p.collateralIn || "0")).length;
  const winRatePct =
    settledEvaluable.length === 0
      ? null
      : Number(((wins / settledEvaluable.length) * 100).toFixed(1));

  return NextResponse.json({
    marketCount,
    pnlUsd: formatSubgraphPnlUsd(pnl),
    depositedUsd: formatSubgraphUsd(deposited),
    redeemedUsd: formatSubgraphUsd(redeemed),
    winRatePct,
  });
}

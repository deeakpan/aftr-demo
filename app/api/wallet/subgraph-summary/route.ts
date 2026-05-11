import { NextRequest, NextResponse } from "next/server";
import { formatUnits, isAddress } from "viem";

const SUBGRAPH_URL =
  process.env.SUBGRAPH_QUERY_URL ??
  "https://api.studio.thegraph.com/query/1749057/aftr/v0.06";

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

const SUBGRAPH_DECIMALS = 18;

function usdStringFromWei(value: bigint): string {
  const n = Number(formatUnits(value, SUBGRAPH_DECIMALS));
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const id = wallet.toLowerCase();
  const graphRes = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query TraderSummary($id: ID!) {
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
      variables: { id },
    }),
    cache: "no-store",
  });

  if (!graphRes.ok) {
    return NextResponse.json({ error: "Subgraph query failed" }, { status: 502 });
  }

  const graphJson = (await graphRes.json()) as GraphResponse;
  const t = graphJson.data?.trader;
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
  const absPnl = pnl < BigInt(0) ? -pnl : pnl;
  const perMarket = graphJson.data?.traderMarketPositions ?? [];
  const settledEvaluable = perMarket.filter((p) => BigInt(p.collateralIn || "0") > BigInt(0));
  const wins = settledEvaluable.filter((p) => BigInt(p.collateralOut || "0") > BigInt(p.collateralIn || "0")).length;
  const winRatePct =
    settledEvaluable.length === 0
      ? null
      : Number(((wins / settledEvaluable.length) * 100).toFixed(1));

  return NextResponse.json({
    marketCount,
    pnlUsd: `${pnl < BigInt(0) ? "-" : ""}${usdStringFromWei(absPnl)}`,
    depositedUsd: usdStringFromWei(deposited),
    redeemedUsd: usdStringFromWei(redeemed),
    winRatePct,
  });
}

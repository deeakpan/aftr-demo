import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import { getSupabaseClient } from "@/lib/supabase/client";
import { querySubgraph } from "@/lib/subgraph/client";

type GraphResponse = {
  data?: {
    traders?: Array<{
      id: string;
      totalDeposited: string;
      totalRedeemed: string;
      positions?: Array<{ id: string }>;
    }>;
  };
};

const DECIMALS = 18;

function usdLike(value: bigint) {
  const n = Number(formatUnits(value, DECIMALS));
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function GET() {
  const graph = await querySubgraph<NonNullable<GraphResponse["data"]>>(
    `query Leaderboard {
      traders(first: 200, orderBy: totalRedeemed, orderDirection: desc) {
        id
        totalDeposited
        totalRedeemed
        positions(first: 1000) { id }
      }
    }`,
  );

  if (!graph.ok) {
    return NextResponse.json({ rows: [], unavailable: true, reason: graph.reason });
  }

  const traders = graph.data.traders ?? [];

  const rows = traders
    .map((t) => {
      const deposited = BigInt(t.totalDeposited || "0");
      const redeemed = BigInt(t.totalRedeemed || "0");
      const pnl = redeemed - deposited;
      return {
        address: t.id,
        marketCount: t.positions?.length ?? 0,
        pnlUsd: `${pnl < BigInt(0) ? "-" : ""}${usdLike(pnl < BigInt(0) ? -pnl : pnl)}`,
        depositedUsd: usdLike(deposited),
        redeemedUsd: usdLike(redeemed),
        pnlWei: pnl.toString(),
      };
    })
    .sort((a, b) => {
      const aa = BigInt(a.pnlWei);
      const bb = BigInt(b.pnlWei);
      if (aa === bb) return b.marketCount - a.marketCount;
      return aa > bb ? -1 : 1;
    })
    .map(({ pnlWei, ...rest }) => rest)
    .slice(0, 100);

  const addresses = rows.map((r) => r.address.toLowerCase());
  let nameByAddress = new Map<string, string>();
  if (addresses.length > 0) {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.from("profiles").select("address,name").in("address", addresses);
      nameByAddress = new Map(
        (data ?? [])
          .filter((p): p is { address: string; name: string } => Boolean(p?.address) && Boolean(p?.name))
          .map((p) => [p.address.toLowerCase(), p.name]),
      );
    } catch {
      // If profile lookup fails, return leaderboard rows with addresses only.
    }
  }

  return NextResponse.json({
    rows: rows.map((r) => ({ ...r, username: nameByAddress.get(r.address.toLowerCase()) ?? null })),
  });
}


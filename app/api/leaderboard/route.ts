import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { querySubgraph } from "@/lib/subgraph/client";
import { formatSubgraphPnlUsd, formatSubgraphUsd } from "@/lib/subgraph/format-collateral-usd";

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
        pnlUsd: formatSubgraphPnlUsd(pnl),
        depositedUsd: formatSubgraphUsd(deposited),
        redeemedUsd: formatSubgraphUsd(redeemed),
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
      const supabase = getSupabaseAdminClient();
      const { data, error } = await supabase.from("profiles").select("address,name").in("address", addresses);
      if (error) throw error;
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


import { NextResponse } from "next/server";
import deployment from "@/lib/deployment";
import { loadMarketsList } from "@/lib/markets/load-markets";

export const revalidate = 20;

export async function GET() {
  try {
    const markets = await loadMarketsList();
    return NextResponse.json(
      { markets, chainId: deployment.chainId },
      { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load markets.";
    return NextResponse.json({ error: message, markets: [], chainId: deployment.chainId }, { status: 502 });
  }
}

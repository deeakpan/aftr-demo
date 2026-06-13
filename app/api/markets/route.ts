import { NextResponse } from "next/server";
import deployment from "@/lib/deployment";
import { loadMarketsList } from "@/lib/markets/load-markets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const markets = await loadMarketsList();
    return NextResponse.json({ markets, chainId: deployment.chainId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load markets.";
    return NextResponse.json({ error: message, markets: [], chainId: deployment.chainId }, { status: 502 });
  }
}

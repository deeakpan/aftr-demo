import { NextResponse } from "next/server";
import deployment from "@/deployments/baseSepolia-84532.json";
import { loadMarketsList } from "@/lib/markets/load-markets";

export const revalidate = 15;

export async function GET() {
  try {
    const markets = await loadMarketsList();
    return NextResponse.json({ markets, chainId: deployment.chainId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load markets.";
    return NextResponse.json({ error: message, markets: [], chainId: deployment.chainId }, { status: 502 });
  }
}

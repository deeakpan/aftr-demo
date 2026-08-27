import { NextResponse } from "next/server";
import deployment, { marketFactoryAddress, undeployedStackMessage } from "@/lib/deployment";
import { loadMarketsList } from "@/lib/markets/load-markets";

export const revalidate = 20;

export async function GET() {
  try {
    if (!marketFactoryAddress()) {
      return NextResponse.json(
        { markets: [], chainId: deployment.chainId, notice: undeployedStackMessage() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const markets = await loadMarketsList();
    const cacheControl =
      markets.length === 0
        ? "no-store"
        : "public, s-maxage=20, stale-while-revalidate=60";
    return NextResponse.json(
      { markets, chainId: deployment.chainId },
      { headers: { "Cache-Control": cacheControl } },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Could not load markets.";
    const message =
      /fetch failed|HTTP request failed|EAI_AGAIN|ETIMEDOUT|Connect Timeout/i.test(raw)
        ? "Market RPC is temporarily unreachable. Try again in a moment."
        : raw.length > 160
          ? `${raw.slice(0, 157)}…`
          : raw;
    return NextResponse.json(
      { error: message, markets: [], chainId: deployment.chainId },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

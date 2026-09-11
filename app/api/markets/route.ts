import { NextResponse } from "next/server";
import deployment, { marketFactoryAddress, undeployedStackMessage } from "@/lib/deployment";
import { loadMarketsList } from "@/lib/markets/load-markets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!marketFactoryAddress()) {
      return NextResponse.json(
        { markets: [], chainId: deployment.chainId, notice: undeployedStackMessage() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    // Always fetch fresh — stale cached lists omit newly created / still-active markets.
    const markets = await loadMarketsList({ force: true });
    return NextResponse.json(
      { markets, chainId: deployment.chainId },
      { headers: { "Cache-Control": "no-store" } },
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

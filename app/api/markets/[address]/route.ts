import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import deployment from "@/lib/deployment";
import { loadMarketDetail, serializeMarketDetail } from "@/lib/markets/load-markets";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ address: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const raw = (await context.params).address?.trim() ?? "";
  if (!raw || !isAddress(raw)) {
    return NextResponse.json({ error: "Invalid market address" }, { status: 400 });
  }

  try {
    const marketAddress = getAddress(raw) as `0x${string}`;
    const market = await loadMarketDetail(marketAddress);
    return NextResponse.json({
      market: serializeMarketDetail(market),
      chainId: deployment.chainId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load market.";
    return NextResponse.json({ error: message, chainId: deployment.chainId }, { status: 502 });
  }
}

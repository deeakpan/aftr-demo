import { NextRequest, NextResponse } from "next/server";
import { fetchPolymarketImport } from "@/lib/polymarket/import";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    const draft = await fetchPolymarketImport(url);
    return NextResponse.json({ draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import from Polymarket.";
    const status = /not found|valid Polymarket/i.test(message) ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

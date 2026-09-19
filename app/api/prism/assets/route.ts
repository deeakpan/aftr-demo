import { NextRequest, NextResponse } from "next/server";
import { fetchPrismAssets, suggestPrismAssets } from "@/lib/prism/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    const suggest = sp.get("suggest") === "1";
    if (suggest) {
      if (q.length < 1) {
        return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
      }
      const results = await suggestPrismAssets(q);
      return NextResponse.json({ results }, { headers: { "Cache-Control": "public, max-age=30" } });
    }

    const data = await fetchPrismAssets({
      q: q || undefined,
      category: sp.get("category") ?? undefined,
      sort: sp.get("sort") ?? "marketCap",
      limit: Number(sp.get("limit") ?? 24) || 24,
      cursor: sp.get("cursor") ?? undefined,
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prism catalogue unavailable.";
    return NextResponse.json({ error: message, items: [] }, { status: 502 });
  }
}

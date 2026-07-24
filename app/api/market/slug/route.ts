import { NextRequest, NextResponse } from "next/server";
import { findMarketBySlug } from "@/lib/markets/find-by-slug";
import { isReservedMarketSlug, normalizeMarketSlug } from "@/lib/markets/market-url";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/slug?slug=foo
 * - resolves slug → market address when taken
 * - `available: true` when free for create
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("slug")?.trim() ?? "";
  const slug = normalizeMarketSlug(raw);
  if (!slug) {
    return NextResponse.json({ error: "Missing slug", available: false }, { status: 400 });
  }
  if (isReservedMarketSlug(slug)) {
    return NextResponse.json({
      slug,
      available: false,
      reason: "reserved",
      address: null,
    });
  }

  const market = await findMarketBySlug(slug);
  if (!market) {
    return NextResponse.json({ slug, available: true, address: null });
  }

  return NextResponse.json({
    slug,
    available: false,
    reason: "taken",
    address: market.address,
    title: market.title ?? null,
  });
}

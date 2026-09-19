import { NextResponse } from "next/server";
import {
  assetImageUri,
  catalogueAssetToLiveStats,
  fetchPrismAsset,
  fetchPrismVerifyGrade,
  primaryDeployment,
} from "@/lib/prism/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, context: Ctx) {
  try {
    const { slug: raw } = await context.params;
    const slug = decodeURIComponent(raw || "").trim();
    if (!slug) {
      return NextResponse.json({ error: "Missing slug." }, { status: 400 });
    }
    const asset = await fetchPrismAsset(slug);
    const dep = primaryDeployment(asset);
    const grade = await fetchPrismVerifyGrade(asset.symbol || slug);
    return NextResponse.json(
      {
        asset: {
          slug: asset.slug,
          symbol: asset.symbol,
          name: asset.name,
          category: asset.category,
          imageUri: assetImageUri(asset),
          address: dep.address,
          chain: dep.chain,
        },
        stats: catalogueAssetToLiveStats(asset),
        grade,
      },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Prism asset.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

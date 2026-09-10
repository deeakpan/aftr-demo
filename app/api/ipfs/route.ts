import { NextResponse } from "next/server";
import { fetchIpfsMetadataNoCache, ipfsToHttp } from "@/lib/ipfs-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side IPFS fetch so dedicated Lighthouse gateway + API key work.
 * Browser cannot call premium Lighthouse gateway without the dedicated URL.
 *
 * GET /api/ipfs?uri=ipfs://Qm...
 * GET /api/ipfs?cid=Qm...
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const uriRaw = searchParams.get("uri")?.trim() || "";
  const cid = searchParams.get("cid")?.trim() || "";
  const uri = uriRaw || (cid ? `ipfs://${cid}` : "");
  if (!uri) {
    return NextResponse.json({ error: "Missing uri or cid." }, { status: 400 });
  }

  const md = await fetchIpfsMetadataNoCache(uri, { attempts: 2, timeoutMs: 8_000 });
  if (!md) {
    return NextResponse.json(
      {
        error:
          "Could not load IPFS metadata. Set LIGHTHOUSE_GATEWAY_URL to your dedicated gateway from the Lighthouse dashboard (public gateway.lighthouse.storage returns 402).",
        gatewayHint: ipfsToHttp(uri),
      },
      { status: 502 },
    );
  }

  return NextResponse.json(md, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}

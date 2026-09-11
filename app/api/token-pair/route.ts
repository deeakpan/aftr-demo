import { NextResponse } from "next/server";
import { TokenPairNotFoundError, fetchTokenPairFromLink } from "@/lib/token-market/fetch-pair";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const url = params.get("url")?.trim() ?? "";
  const display = params.get("display") === "1" || params.get("display") === "true";
  if (!url) return NextResponse.json({ error: "url is required." }, { status: 400 });
  try {
    const data = await fetchTokenPairFromLink(url, { requireMinLiquidity: !display });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load pair";
    const status = error instanceof TokenPairNotFoundError ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

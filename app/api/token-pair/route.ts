import { NextResponse } from "next/server";
import { TokenPairNotFoundError, fetchTokenPairFromLink } from "@/lib/token-market/fetch-pair";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url")?.trim() ?? "";
  if (!url) return NextResponse.json({ error: "url is required." }, { status: 400 });
  try {
    const data = await fetchTokenPairFromLink(url);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load pair";
    const status = error instanceof TokenPairNotFoundError ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

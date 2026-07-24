import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_HOST_SUFFIXES = [
  "polymarket.com",
  "polymarket-upload.s3.us-east-2.amazonaws.com",
  "polymarket-static.s3.us-east-2.amazonaws.com",
  "s3.us-east-2.amazonaws.com",
];

function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`) || host.endsWith(s));
}

/** Proxy Polymarket cover images so the create form can attach them without CORS issues. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!raw) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (target.protocol !== "https:") {
    return NextResponse.json({ error: "Only https images are allowed." }, { status: 400 });
  }
  if (!isAllowedImageHost(target.hostname)) {
    return NextResponse.json({ error: "Image host not allowed." }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { Accept: "image/*,*/*" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `Image fetch failed (${upstream.status}).` }, { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "URL did not return an image." }, { status: 502 });
    }
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image fetch failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

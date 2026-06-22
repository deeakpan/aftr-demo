import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { NadTokenNotFoundError, fetchNadTokenMetadata } from "@/lib/nad/api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ address: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const raw = (await context.params).address?.trim() ?? "";
  if (!raw || !isAddress(raw)) {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  try {
    const token = getAddress(raw);
    const data = await fetchNadTokenMetadata(token);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nad API error";
    if (error instanceof NadTokenNotFoundError) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

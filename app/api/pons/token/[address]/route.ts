import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { PonsTokenNotFoundError, fetchPonsToken } from "@/lib/pons/onchain";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ address: string }> };

function publicPonsError(error: unknown): string {
  if (error instanceof PonsTokenNotFoundError) return error.message;
  const message = error instanceof Error ? error.message : "Could not load Pons token";
  if (/viem|Contract Call|returned no data|getLaunchedToken/i.test(message)) {
    return "Could not find this token on Pons Family. Paste a Pons V2 token CA from ponsfamily.com.";
  }
  return message;
}

export async function GET(_req: Request, context: RouteContext) {
  const raw = (await context.params).address?.trim() ?? "";
  if (!raw || !isAddress(raw)) {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  try {
    const token = getAddress(raw);
    const data = await fetchPonsToken(token);
    return NextResponse.json(data);
  } catch (error) {
    const message = publicPonsError(error);
    const status = error instanceof PonsTokenNotFoundError ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { registerParaWallet } from "@/lib/para-session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      owner?: string;
      paraUserId?: string | null;
      walletId?: string | null;
      session?: unknown;
      sessionCookie?: string | null;
      email?: string | null;
    };
    const result = await registerParaWallet({
      owner: body.owner ?? "",
      paraUserId: body.paraUserId,
      walletId: body.walletId,
      session: body.session,
      sessionCookie: body.sessionCookie,
      email: body.email,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Para register failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

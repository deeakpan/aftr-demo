import { NextResponse } from "next/server";
import { getAddress, isAddress, type Hex } from "viem";
import { sendViaPara } from "@/lib/para-server-execute";
import { formatUserTxError } from "@/lib/tx-error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      owner?: string;
      to?: string;
      data?: string;
      value?: string;
      walletId?: string;
    };
    if (!body.owner || !isAddress(body.owner) || !body.to || !isAddress(body.to)) {
      return NextResponse.json({ error: "Invalid owner or to address." }, { status: 400 });
    }
    const result = await sendViaPara(getAddress(body.owner) as `0x${string}`, {
      to: getAddress(body.to) as `0x${string}`,
      data: (body.data as Hex | undefined) ?? "0x",
      value: body.value ? BigInt(body.value) : BigInt(0),
    }, body.walletId?.trim());
    return NextResponse.json({ hash: result.hash });
  } catch (error) {
    const message = formatUserTxError(error, "Transaction failed. Try again.");
    console.error("[para/send]", message, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

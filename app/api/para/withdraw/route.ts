import { NextResponse } from "next/server";
import { encodeFunctionData, erc20Abi, getAddress, isAddress, zeroAddress, type Hex } from "viem";
import { sendViaPara } from "@/lib/para-server-execute";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      owner?: string;
      to?: string;
      token?: string;
      amount?: string;
    };
    if (!body.owner || !isAddress(body.owner) || !body.to || !isAddress(body.to) || !body.amount) {
      return NextResponse.json({ error: "Invalid withdraw request." }, { status: 400 });
    }
    const owner = getAddress(body.owner) as `0x${string}`;
    const to = getAddress(body.to) as `0x${string}`;
    const amount = BigInt(body.amount);
    if (amount <= BigInt(0)) {
      return NextResponse.json({ error: "Amount must be greater than zero." }, { status: 400 });
    }

    const token = body.token && isAddress(body.token) ? getAddress(body.token) : zeroAddress;
    if (token === zeroAddress) {
      const result = await sendViaPara(owner, { to, data: "0x", value: amount });
      return NextResponse.json({ hash: result.hash });
    }

    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
    }) as Hex;
    const result = await sendViaPara(owner, { to: token, data, value: BigInt(0) });
    return NextResponse.json({ hash: result.hash });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Para withdraw failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

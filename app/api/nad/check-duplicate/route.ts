import { NextResponse } from "next/server";
import { isAddress } from "viem";
import deployment from "@/lib/deployment";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import { findDuplicateNadMarkets } from "@/lib/nad/duplicates";
import { parseAbi } from "viem";

export const dynamic = "force-dynamic";

const FACTORY = deployment.contracts.MondaloreParimutuelMarketFactory as `0x${string}`;
const FACTORY_ABI = parseAbi([
  "function marketsLength() view returns (uint256)",
  "function markets(uint256) view returns (address)",
]);
const MARKET_ABI = parseAbi([
  "function metadataURI() view returns (string)",
  "function state() view returns (uint8)",
]);

export async function POST(req: Request) {
  let body: {
    questionType?: string;
    tokenAddresses?: string[];
    resolveAfterUnix?: number;
    thresholdUsd?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const questionType = body.questionType?.trim();
  const tokenAddresses = (body.tokenAddresses ?? []).map((a) => a.trim()).filter(Boolean);
  const resolveAfterUnix = Number(body.resolveAfterUnix);

  if (!questionType) {
    return NextResponse.json({ error: "questionType required." }, { status: 400 });
  }
  if (!tokenAddresses.length || tokenAddresses.some((a) => !isAddress(a))) {
    return NextResponse.json({ error: "Valid tokenAddresses required." }, { status: 400 });
  }
  if (!Number.isFinite(resolveAfterUnix) || resolveAfterUnix <= 0) {
    return NextResponse.json({ error: "resolveAfterUnix required." }, { status: 400 });
  }

  try {
    const client = deploymentPublicClient;
    const len = Number(await client.readContract({
      address: FACTORY,
      abi: FACTORY_ABI,
      functionName: "marketsLength",
    }));

    const scan = Math.min(len, 48);
    const start = Math.max(0, len - scan);
    const rows: { address: string; metadataUri: string; state: number }[] = [];

    for (let i = start; i < len; i += 1) {
      const addr = (await client.readContract({
        address: FACTORY,
        abi: FACTORY_ABI,
        functionName: "markets",
        args: [BigInt(i)],
      })) as string;

      const [uri, state] = await client.multicall({
        contracts: [
          { address: addr as `0x${string}`, abi: MARKET_ABI, functionName: "metadataURI" },
          { address: addr as `0x${string}`, abi: MARKET_ABI, functionName: "state" },
        ],
      });

      if (uri.status !== "success" || state.status !== "success") continue;
      rows.push({
        address: addr,
        metadataUri: uri.result as string,
        state: Number(state.result),
      });
    }

    const duplicates = await findDuplicateNadMarkets(
      {
        questionType,
        tokenAddresses,
        resolveAfterUnix,
        thresholdUsd: body.thresholdUsd?.trim() || undefined,
      },
      rows,
    );

    return NextResponse.json({ duplicates, checked: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Duplicate check failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

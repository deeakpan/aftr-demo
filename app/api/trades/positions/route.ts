import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, formatUnits, http, isAddress, parseAbi } from "viem";
import deployment from "@/deployments/baseSepolia-84532.json";
import { querySubgraph } from "@/lib/subgraph/client";
const RPC_URL = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;

const MARKET_ABI = parseAbi([
  "function marketKind() view returns (uint8)",
  "function state() view returns (uint8)",
  "function stakeEndTimestamp() view returns (uint256)",
  "function collateralAddress() view returns (address)",
  "function numOutcomes() view returns (uint8)",
  "function outcomeToken(uint256) view returns (address)",
  "function collateralDecimals() view returns (uint8)",
  "function winningOutcomeIndex() view returns (uint256)",
  "function redemptionRate() view returns (uint256)",
  "function metadataURI() view returns (string)",
  "function priceOf(uint8 outcomeIndex) view returns (uint256)",
  "function realPool(uint256 outcomeIndex) view returns (uint256)",
]);

const ERC20_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

type SubgraphResponse = {
  data?: {
    traderMarketPositions?: Array<{
      market: { id: string };
      collateralIn: string;
      collateralOut: string;
      sharesIn: string;
      sharesOut: string;
    }>;
  };
};

type IpfsMetadata = {
  title?: string;
  outcomes?: string[];
  image?: string;
};

function ipfsToHttp(uri: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.lighthouse.storage/ipfs/${uri.replace("ipfs://", "")}`;
  }
  return uri;
}

async function fetchMetadata(uri: string): Promise<IpfsMetadata | null> {
  const url = ipfsToHttp(uri);
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as IpfsMetadata;
  } catch {
    return null;
  }
}

function fmtTs(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, v));
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }
  if (!RPC_URL) {
    return NextResponse.json({ error: "Missing RPC URL" }, { status: 500 });
  }

  const graph = await querySubgraph<NonNullable<SubgraphResponse["data"]>>(
    `query WalletPositions($wallet: String!) {
      traderMarketPositions(where: { trader: $wallet }, first: 500) {
        market { id }
        collateralIn
        collateralOut
        sharesIn
        sharesOut
      }
    }`,
    { wallet: wallet.toLowerCase() },
  );

  if (!graph.ok) {
    return NextResponse.json({
      rows: [],
      chainId: deployment.chainId,
      unavailable: true,
      reason: graph.reason,
    });
  }

  const positionRows = graph.data.traderMarketPositions ?? [];
  if (positionRows.length === 0) {
    return NextResponse.json({ rows: [], chainId: deployment.chainId });
  }

  const byMarket = new Map<string, (typeof positionRows)[number]>();
  for (const p of positionRows) {
    byMarket.set(p.market.id.toLowerCase(), p);
  }

  const publicClient = createPublicClient({
    chain: undefined,
    transport: http(RPC_URL),
  });

  const outRows: Array<Record<string, unknown>> = [];
  for (const [marketAddress, pos] of byMarket.entries()) {
    const market = marketAddress as `0x${string}`;
    const [
      kindRaw,
      stateRaw,
      stakeEndRaw,
      collateralAddressRaw,
      outcomesRaw,
      collateralDecimalsRaw,
      winningRaw,
      redemptionRate,
      metadataUri,
    ] = await Promise.all([
      publicClient.readContract({ address: market, abi: MARKET_ABI, functionName: "marketKind" }),
      publicClient.readContract({ address: market, abi: MARKET_ABI, functionName: "state" }),
      publicClient.readContract({ address: market, abi: MARKET_ABI, functionName: "stakeEndTimestamp" }),
      publicClient.readContract({ address: market, abi: MARKET_ABI, functionName: "collateralAddress" }),
      publicClient.readContract({ address: market, abi: MARKET_ABI, functionName: "numOutcomes" }),
      publicClient.readContract({ address: market, abi: MARKET_ABI, functionName: "collateralDecimals" }),
      publicClient.readContract({ address: market, abi: MARKET_ABI, functionName: "winningOutcomeIndex" }),
      publicClient.readContract({ address: market, abi: MARKET_ABI, functionName: "redemptionRate" }),
      publicClient.readContract({ address: market, abi: MARKET_ABI, functionName: "metadataURI" }),
    ]);

    const numOutcomes = Number(outcomesRaw);
    const collateralDecimals = Number(collateralDecimalsRaw);
    const state = Number(stateRaw);
    const kind = Number(kindRaw) === 0 ? "Price" : "Event";
    const metadata = await fetchMetadata(String(metadataUri || ""));
    const marketTitle = metadata?.title?.trim() || `${kind} market`;
    const labels = metadata?.outcomes?.filter((x): x is string => typeof x === "string") ?? [];
    const fallbackLabels = Array.from({ length: numOutcomes }, (_, i) => `Outcome ${i + 1}`);
    const outcomeLabels = labels.length > 0 ? labels : fallbackLabels;

    let chancePct = numOutcomes >= 2 ? 50 : Math.max(1, Math.round(100 / Math.max(1, numOutcomes)));
    try {
      const p0 = await publicClient.readContract({
        address: market,
        abi: MARKET_ABI,
        functionName: "priceOf",
        args: [0],
      });
      chancePct = clampPct(Number(formatUnits(p0 as bigint, 18)) * 100);
    } catch {
      // keep fallback
    }

    const realPoolParts = await Promise.all(
      Array.from({ length: numOutcomes }, (_, i) =>
        publicClient.readContract({
          address: market,
          abi: MARKET_ABI,
          functionName: "realPool",
          args: [BigInt(i)],
        }),
      ),
    );
    const poolTvlRaw = realPoolParts.reduce((acc, v) => acc + (v as bigint), BigInt(0));
    const poolTvlDisplay = Number(formatUnits(poolTvlRaw, collateralDecimals)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
    const stakeEndUnix = Number(stakeEndRaw);
    const stakeEndsLabel = fmtTs(stakeEndUnix);
    const imageUrl = ipfsToHttp(metadata?.image?.trim() || "");
    const winningOutcomeIndex = state === 2 ? Number(winningRaw) : null;

    const outcomeTokens = await Promise.all(
      Array.from({ length: numOutcomes }, (_, i) =>
        publicClient.readContract({
          address: market,
          abi: MARKET_ABI,
          functionName: "outcomeToken",
          args: [BigInt(i)],
        }) as Promise<`0x${string}`>,
      ),
    );

    const balances: bigint[] = [];
    for (let i = 0; i < outcomeTokens.length; i += 1) {
      const bal = (await publicClient.readContract({
        address: outcomeTokens[i]!,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet as `0x${string}`],
      })) as bigint;
      balances.push(bal);
    }

    let emittedPositiveBalance = false;
    for (let i = 0; i < outcomeTokens.length; i += 1) {
      const bal = balances[i]!;
      if (bal <= BigInt(0)) continue;
      emittedPositiveBalance = true;
      outRows.push({
        marketAddress: market,
        marketTitle,
        marketKind: kind,
        marketState: state,
        stakeEndUnix,
        collateralAddress: collateralAddressRaw as `0x${string}`,
        winningOutcomeIndex,
        redemptionRate: redemptionRate.toString(),
        outcomeIndex: i,
        outcomeLabel: outcomeLabels[i] ?? `Outcome ${i + 1}`,
        outcomeLabels,
        balance: bal.toString(),
        collateralDecimals,
        chancePct,
        poolTvlDisplay,
        stakeEndsLabel,
        imageUrl,
        indexedCollateralIn: pos.collateralIn,
        indexedCollateralOut: pos.collateralOut,
        indexedSharesIn: pos.sharesIn,
        indexedSharesOut: pos.sharesOut,
      });
    }

    // Settled market, no outcome tokens left, but subgraph shows this wallet traded — keep the card (e.g. claimed winnings).
    if (state === 2 && !emittedPositiveBalance && winningOutcomeIndex !== null) {
      const collateralIn = BigInt(pos.collateralIn || "0");
      const collateralOut = BigInt(pos.collateralOut || "0");
      const sharesIn = BigInt(pos.sharesIn || "0");
      const sharesOut = BigInt(pos.sharesOut || "0");
      const participated = collateralIn > BigInt(0) || sharesIn > BigInt(0);
      const indexerShowsRedeem = collateralOut > BigInt(0) || sharesOut > BigInt(0);

      if (participated) {
        const winIdx = winningOutcomeIndex as number;
        const settlementDisplay = indexerShowsRedeem ? "claimed" : "settled_no_shares";
        outRows.push({
          marketAddress: market,
          marketTitle,
          marketKind: kind,
          marketState: state,
          stakeEndUnix,
          collateralAddress: collateralAddressRaw as `0x${string}`,
          winningOutcomeIndex,
          redemptionRate: redemptionRate.toString(),
          outcomeIndex: winIdx,
          outcomeLabel: outcomeLabels[winIdx] ?? `Outcome ${winIdx + 1}`,
          outcomeLabels,
          balance: "0",
          collateralDecimals,
          chancePct,
          poolTvlDisplay,
          stakeEndsLabel,
          imageUrl,
          indexedCollateralIn: pos.collateralIn,
          indexedCollateralOut: pos.collateralOut,
          indexedSharesIn: pos.sharesIn,
          indexedSharesOut: pos.sharesOut,
          settlementDisplay,
        });
      }
    }
  }

  return NextResponse.json({ rows: outRows, chainId: deployment.chainId });
}


import { NextRequest, NextResponse } from "next/server";
import { formatUnits, isAddress, parseAbi, parseAbiItem } from "viem";
import deployment from "@/lib/deployment";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import { fetchIpfsMetadata, ipfsToHttp } from "@/lib/ipfs-metadata";
import { isListableMarket } from "@/lib/market-metadata";
import { querySubgraph } from "@/lib/subgraph/client";

const TOKENS_REDEEMED_EVENT = parseAbiItem(
  "event TokensRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout)",
);

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

type TraderMarketPositionRow = {
  market: { id: string };
  collateralIn: string;
  collateralOut: string;
  sharesIn: string;
  sharesOut: string;
};

type SubgraphResponse = {
  data?: {
    traderMarketPositions?: TraderMarketPositionRow[];
  };
};

function fmtTs(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, v));
}

async function marketRedemptionTotal(
  wallet: `0x${string}`,
  market: `0x${string}`,
): Promise<bigint> {
  try {
    const logs = await deploymentPublicClient.getLogs({
      address: market,
      event: TOKENS_REDEEMED_EVENT,
      args: { user: wallet },
      fromBlock: BigInt(0),
      toBlock: "latest",
    });
    let total = BigInt(0);
    for (const log of logs) {
      const payout = log.args.payout;
      if (typeof payout === "bigint") total += payout;
    }
    return total;
  } catch {
    return BigInt(0);
  }
}

async function buildRowsForMarket(
  wallet: `0x${string}`,
  marketAddress: string,
  pos: TraderMarketPositionRow,
): Promise<Array<Record<string, unknown>>> {
  const market = marketAddress as `0x${string}`;
  const publicClient = deploymentPublicClient;

  const base = await publicClient.multicall({
    contracts: [
      { address: market, abi: MARKET_ABI, functionName: "marketKind" },
      { address: market, abi: MARKET_ABI, functionName: "state" },
      { address: market, abi: MARKET_ABI, functionName: "stakeEndTimestamp" },
      { address: market, abi: MARKET_ABI, functionName: "collateralAddress" },
      { address: market, abi: MARKET_ABI, functionName: "numOutcomes" },
      { address: market, abi: MARKET_ABI, functionName: "collateralDecimals" },
      { address: market, abi: MARKET_ABI, functionName: "winningOutcomeIndex" },
      { address: market, abi: MARKET_ABI, functionName: "redemptionRate" },
      { address: market, abi: MARKET_ABI, functionName: "metadataURI" },
    ],
  });

  const kindRaw = base[0]?.result;
  const stateRaw = base[1]?.result;
  const stakeEndRaw = base[2]?.result;
  const collateralAddressRaw = base[3]?.result;
  const outcomesRaw = base[4]?.result;
  const collateralDecimalsRaw = base[5]?.result;
  const winningRaw = base[6]?.result;
  const redemptionRate = base[7]?.result;
  const metadataUri = base[8]?.result;

  if (
    kindRaw === undefined ||
    stateRaw === undefined ||
    stakeEndRaw === undefined ||
    collateralAddressRaw === undefined ||
    outcomesRaw === undefined ||
    collateralDecimalsRaw === undefined ||
    winningRaw === undefined ||
    redemptionRate === undefined
  ) {
    return [];
  }

  const numOutcomes = Number(outcomesRaw);
  const collateralDecimals = Number(collateralDecimalsRaw);
  const state = Number(stateRaw);
  const kind = Number(kindRaw) === 0 ? "Price" : "Event";
  const metadataUriStr = String(metadataUri || "");
  const metadata = await fetchIpfsMetadata(metadataUriStr);
  if (!isListableMarket(metadataUriStr, metadata?.image)) {
    return [];
  }
  const marketTitle = metadata?.title?.trim() || `${kind} market`;
  const labels = metadata?.outcomes?.filter((x): x is string => typeof x === "string") ?? [];
  const fallbackLabels = Array.from({ length: numOutcomes }, (_, i) => `Outcome ${i + 1}`);
  const outcomeLabels = labels.length > 0 ? labels : fallbackLabels;

  const outcomeContracts = Array.from({ length: numOutcomes }, (_, i) => [
    { address: market, abi: MARKET_ABI, functionName: "priceOf" as const, args: [i] as const },
    { address: market, abi: MARKET_ABI, functionName: "realPool" as const, args: [BigInt(i)] as const },
    { address: market, abi: MARKET_ABI, functionName: "outcomeToken" as const, args: [BigInt(i)] as const },
  ]).flat();

  const outcomeReads = outcomeContracts.length
    ? await publicClient.multicall({ contracts: outcomeContracts })
    : [];

  let chancePct = numOutcomes >= 2 ? 50 : Math.max(1, Math.round(100 / Math.max(1, numOutcomes)));
  let outcomeChancePcts = Array.from({ length: numOutcomes }, (_, i) =>
    i === 0 ? chancePct : Math.round((100 - chancePct) / Math.max(1, numOutcomes - 1)),
  );

  let poolTvlRaw = BigInt(0);
  const outcomeTokens: `0x${string}`[] = [];
  for (let i = 0; i < numOutcomes; i += 1) {
    const price = outcomeReads[i * 3]?.result as bigint | undefined;
    const pool = outcomeReads[i * 3 + 1]?.result as bigint | undefined;
    const token = outcomeReads[i * 3 + 2]?.result as `0x${string}` | undefined;
    if (pool !== undefined) poolTvlRaw += pool;
    if (price !== undefined) {
      outcomeChancePcts[i] = clampPct(Number(formatUnits(price, 18)) * 100);
    }
    if (token) outcomeTokens.push(token);
  }
  if (outcomeChancePcts.length === numOutcomes) {
    chancePct = outcomeChancePcts[0] ?? chancePct;
  }

  const poolTvlDisplay = Number(formatUnits(poolTvlRaw, collateralDecimals)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  const stakeEndUnix = Number(stakeEndRaw);
  const stakeEndsLabel = fmtTs(stakeEndUnix);
  const imageUrl = ipfsToHttp(metadata?.image?.trim() || "");
  const winningOutcomeIndex = state === 2 ? Number(winningRaw) : null;

  const balanceReads = outcomeTokens.length
    ? await publicClient.multicall({
        contracts: outcomeTokens.map((token) => ({
          address: token,
          abi: ERC20_ABI,
          functionName: "balanceOf" as const,
          args: [wallet] as const,
        })),
      })
    : [];

  const balances = balanceReads.map((r) => (r.result as bigint | undefined) ?? BigInt(0));

  const collateralIn = BigInt(pos.collateralIn || "0");
  let collateralOut = BigInt(pos.collateralOut || "0");
  const sharesIn = BigInt(pos.sharesIn || "0");
  const sharesOut = BigInt(pos.sharesOut || "0");
  if (state === 2 && collateralOut === BigInt(0)) {
    const marketOut = await marketRedemptionTotal(wallet, market);
    if (marketOut > collateralOut) collateralOut = marketOut;
  }

  const participated = collateralIn > BigInt(0) || sharesIn > BigInt(0);
  const indexerShowsRedeem = collateralOut > BigInt(0) || sharesOut > BigInt(0);
  const emittedPositiveBalance = balances.some((b) => b > BigInt(0));
  let settlementDisplay: "claimed" | "settled_no_shares" | undefined;
  if (state === 2 && participated && winningOutcomeIndex !== null) {
    if (indexerShowsRedeem) settlementDisplay = "claimed";
    else if (!emittedPositiveBalance) settlementDisplay = "settled_no_shares";
  }

  const outRows: Array<Record<string, unknown>> = [];
  const rowBase = {
    marketAddress: market,
    marketTitle,
    marketKind: kind,
    marketState: state,
    stakeEndUnix,
    collateralAddress: collateralAddressRaw as `0x${string}`,
    winningOutcomeIndex,
    redemptionRate: redemptionRate.toString(),
    outcomeLabels,
    collateralDecimals,
    chancePct,
    outcomeChancePcts,
    poolTvlDisplay,
    stakeEndsLabel,
    imageUrl,
    indexedCollateralIn: pos.collateralIn,
    indexedCollateralOut: collateralOut.toString(),
    indexedSharesIn: pos.sharesIn,
    indexedSharesOut: pos.sharesOut,
    settlementDisplay,
  };

  for (let i = 0; i < balances.length; i += 1) {
    const bal = balances[i]!;
    if (bal <= BigInt(0)) continue;
    outRows.push({
      ...rowBase,
      outcomeIndex: i,
      outcomeLabel: outcomeLabels[i] ?? `Outcome ${i + 1}`,
      balance: bal.toString(),
    });
  }

  if (state === 2 && !emittedPositiveBalance && winningOutcomeIndex !== null && participated) {
    const winIdx = winningOutcomeIndex as number;
    outRows.push({
      ...rowBase,
      outcomeIndex: winIdx,
      outcomeLabel: outcomeLabels[winIdx] ?? `Outcome ${winIdx + 1}`,
      balance: "0",
    });
  }

  return outRows;
}

export async function GET(req: NextRequest) {
  try {
    const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
    if (!wallet || !isAddress(wallet)) {
      return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
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

    const outRows: Array<Record<string, unknown>> = [];
    for (const [marketAddress, pos] of byMarket.entries()) {
      try {
        const rows = await buildRowsForMarket(wallet as `0x${string}`, marketAddress, pos);
        outRows.push(...rows);
      } catch {
        // Skip markets that fail to load (stale address, RPC hiccup, etc.)
      }
    }

    return NextResponse.json({ rows: outRows, chainId: deployment.chainId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load trades.";
    return NextResponse.json({ error: message, rows: [], chainId: deployment.chainId }, { status: 500 });
  }
}

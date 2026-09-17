import { NextRequest, NextResponse } from "next/server";
import { formatUnits, isAddress, parseAbi, parseAbiItem } from "viem";
import deployment from "@/lib/deployment";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import { fetchIpfsMetadata, ipfsToHttp } from "@/lib/ipfs-metadata";
import { launchpadMarketForDisplay, launchpadMarketFromMetadata, uiMarketKindForDisplay } from "@/lib/launchpad-display";
import { querySubgraph } from "@/lib/subgraph/client";
import { MARKET_READ_ABI, marketTvlBalanceCall } from "@/lib/market-abi";

export const dynamic = "force-dynamic";

const TOKENS_REDEEMED_EVENT = parseAbiItem(
  "event TokensRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout)",
);

const MARKET_ABI = MARKET_READ_ABI;

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

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function marketRedemptionTotal(
  wallet: `0x${string}`,
  market: `0x${string}`,
): Promise<bigint> {
  try {
    const startBlock = BigInt(
      (deployment as { deploymentBlocks?: { ZedkrFpmmMarketFactory?: number } }).deploymentBlocks
        ?.ZedkrFpmmMarketFactory ?? 0,
    );
    const logs = await deploymentPublicClient.getLogs({
      address: market,
      event: TOKENS_REDEEMED_EVENT,
      args: { user: wallet },
      fromBlock: startBlock > BigInt(0) ? startBlock : BigInt(0),
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

function stubRowsFromIndexer(
  marketAddress: string,
  pos: TraderMarketPositionRow,
): Array<Record<string, unknown>> {
  const participated =
    BigInt(pos.collateralIn || "0") > BigInt(0) || BigInt(pos.sharesIn || "0") > BigInt(0);
  if (!participated) return [];
  return [
    {
      marketAddress: marketAddress as `0x${string}`,
      marketTitle: "Market",
      marketKind: "token",
      marketState: 0,
      stakeEndUnix: 0,
      collateralAddress: "0x0000000000000000000000000000000000000000",
      winningOutcomeIndex: null,
      redemptionRate: "0",
      outcomeIndex: 0,
      outcomeLabel: "Position",
      outcomeLabels: ["Position"],
      balance: "0",
      collateralDecimals: 6,
      chancePct: 50,
      outcomeChancePcts: [50],
      poolTvlDisplay: "—",
      stakeEndsLabel: "—",
      imageUrl: "",
      nadMarket: null,
      indexedCollateralIn: pos.collateralIn,
      indexedCollateralOut: pos.collateralOut,
      indexedSharesIn: pos.sharesIn,
      indexedSharesOut: pos.sharesOut,
      settlementDisplay: undefined,
    },
  ];
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
    return stubRowsFromIndexer(marketAddress, pos);
  }

  const numOutcomes = Number(outcomesRaw);
  const collateralDecimals = Number(collateralDecimalsRaw);
  const state = Number(stateRaw);
  const metadataUriStr = String(metadataUri || "");
  const metadata = metadataUriStr ? await fetchIpfsMetadata(metadataUriStr) : null;
  // Never drop indexed activity because IPFS cover failed — degraded title is fine.
  const kind = uiMarketKindForDisplay(Number(kindRaw), metadata as Record<string, unknown> | null);
  const marketTitle = metadata?.title?.trim() || `${kind} market`;
  const marketSlug = metadata?.slug?.trim() || undefined;
  const labels = metadata?.outcomes?.filter((x): x is string => typeof x === "string") ?? [];
  const fallbackLabels = Array.from({ length: numOutcomes }, (_, i) => `Outcome ${i + 1}`);
  const outcomeLabels = labels.length > 0 ? labels : fallbackLabels;

  const collateralAddress = collateralAddressRaw as `0x${string}`;
  const outcomeContracts = Array.from({ length: numOutcomes }, (_, i) => [
    { address: market, abi: MARKET_ABI, functionName: "priceOf" as const, args: [i] as const },
    { address: market, abi: MARKET_ABI, functionName: "outcomeToken" as const, args: [BigInt(i)] as const },
  ]).flat();

  const [outcomeReads, tvlReads] = await Promise.all([
    outcomeContracts.length
      ? publicClient.multicall({ contracts: outcomeContracts })
      : Promise.resolve([]),
    publicClient.multicall({
      contracts: [marketTvlBalanceCall(market, collateralAddress)],
    }),
  ]);

  let chancePct = numOutcomes >= 2 ? 50 : Math.max(1, Math.round(100 / Math.max(1, numOutcomes)));
  let outcomeChancePcts = Array.from({ length: numOutcomes }, (_, i) =>
    i === 0 ? chancePct : Math.round((100 - chancePct) / Math.max(1, numOutcomes - 1)),
  );

  const poolTvlRaw = (tvlReads[0]?.result as bigint | undefined) ?? BigInt(0);
  const outcomeTokens: `0x${string}`[] = [];
  for (let i = 0; i < numOutcomes; i += 1) {
    const price = outcomeReads[i * 2]?.result as bigint | undefined;
    const token = outcomeReads[i * 2 + 1]?.result as `0x${string}` | undefined;
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
  const nadMarket = launchpadMarketForDisplay(metadata as Record<string, unknown> | null) ?? null;
  const launchpadRaw = launchpadMarketFromMetadata(metadata as Record<string, unknown> | null);
  const imageUrl = nadMarket
    ? ipfsToHttp(metadata?.image?.trim() || "")
    : ipfsToHttp(metadata?.image?.trim() || "") ||
      launchpadRaw?.tokens?.[0]?.imageUri?.trim() ||
      metadata?.nadMarket?.tokens?.[0]?.imageUri?.trim() ||
      "";
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
  // Only hit getLogs when indexer has no redeem amount — full-range scans are slow/flaky.
  if (state === 2 && collateralOut === BigInt(0)) {
    const marketOut = await marketRedemptionTotal(wallet, market);
    if (marketOut > collateralOut) collateralOut = marketOut;
  }

  const participated = collateralIn > BigInt(0) || sharesIn > BigInt(0);
  const indexerShowsRedeem = collateralOut > BigInt(0) || sharesOut > BigInt(0);
  const emittedPositiveBalance = balances.some((b) => b > BigInt(0));
  const holdsWinningShares =
    winningOutcomeIndex !== null &&
    balances[winningOutcomeIndex as number] !== undefined &&
    balances[winningOutcomeIndex as number]! > BigInt(0);
  let settlementDisplay: "claimed" | "settled_no_shares" | undefined;
  if (state === 2 && participated && winningOutcomeIndex !== null) {
    if (indexerShowsRedeem || collateralOut > BigInt(0)) {
      settlementDisplay = "claimed";
    } else if (!emittedPositiveBalance || !holdsWinningShares) {
      settlementDisplay = "settled_no_shares";
    }
  }

  const outRows: Array<Record<string, unknown>> = [];
  const rowBase = {
    marketAddress: market,
    marketTitle,
    slug: marketSlug,
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
    nadMarket,
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

  // Keep indexed activity visible even after selling / claiming to zero.
  if (outRows.length === 0 && participated) {
    const idx =
      winningOutcomeIndex !== null && winningOutcomeIndex >= 0
        ? winningOutcomeIndex
        : 0;
    outRows.push({
      ...rowBase,
      outcomeIndex: idx,
      outcomeLabel: outcomeLabels[idx] ?? `Outcome ${idx + 1}`,
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
      return NextResponse.json(
        {
          rows: [],
          chainId: deployment.chainId,
          unavailable: true,
          reason: graph.reason,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const positionRows = graph.data.traderMarketPositions ?? [];
    if (positionRows.length === 0) {
      return NextResponse.json(
        { rows: [], chainId: deployment.chainId },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const byMarket = new Map<string, (typeof positionRows)[number]>();
    for (const p of positionRows) {
      byMarket.set(p.market.id.toLowerCase(), p);
    }

    const marketEntries = [...byMarket.entries()];
    const built = await mapPool(marketEntries, 4, async ([marketAddress, pos]) => {
      try {
        return await buildRowsForMarket(wallet as `0x${string}`, marketAddress, pos);
      } catch (err) {
        console.warn(
          "[trades/positions] market load failed",
          marketAddress,
          err instanceof Error ? err.message : err,
        );
        return stubRowsFromIndexer(marketAddress, pos);
      }
    });

    const outRows = built.flat();
    return NextResponse.json(
      {
        rows: outRows,
        chainId: deployment.chainId,
        indexedCount: byMarket.size,
        loadedCount: outRows.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load trades.";
    return NextResponse.json(
      { error: message, rows: [], chainId: deployment.chainId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

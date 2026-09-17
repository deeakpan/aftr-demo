import { formatUnits, parseAbi, type Abi } from "viem";
import { unstable_cache } from "next/cache";
import { fetchMarketsFromSubgraph, type SubgraphMarketIndex } from "@/lib/subgraph/market-index";
import { fetchMarketVolumesFromSubgraph } from "@/lib/subgraph/market-volume";
import { fpmmFactoryAddress } from "@/lib/market-factory";
import { marketTvlBalanceCall } from "@/lib/market-abi";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import { fetchIpfsMetadata, ipfsToHttp, type IpfsMarketMetadata } from "@/lib/ipfs-metadata";
import { normalizeResolutionSources, type ResolutionSource } from "@/lib/market-resolution-sources";
import { isListableMarket, isValidMetadataUri } from "@/lib/market-metadata";
import { launchpadMarketForDisplay, launchpadMarketFromMetadata, uiMarketKindForDisplay } from "@/lib/launchpad-display";
import { isPriceMarketKind, type UiMarketKind } from "@/lib/markets/market-kind";

const FACTORY_ABI = parseAbi([
  "function marketsLength() view returns (uint256)",
  "function markets(uint256) view returns (address)",
]);

const MARKET_ABI = parseAbi([
  "function marketKind() view returns (uint8)",
  "function metadataURI() view returns (string)",
  "function stakeEndTimestamp() view returns (uint256)",
  "function resolveAfterTimestamp() view returns (uint256)",
  "function numOutcomes() view returns (uint8)",
  "function state() view returns (uint8)",
  "function collateralDecimals() view returns (uint8)",
  "function collateralAddress() view returns (address)",
  "function realPool(uint256 outcomeIndex) view returns (uint256)",
  "function poolBalances(uint256 outcomeIndex) view returns (uint256)",
  "function priceOf(uint8 outcomeIndex) view returns (uint256)",
  "function priceBinLower(uint256) view returns (uint256)",
  "function priceBinUpper(uint256) view returns (uint256)",
  "function chainlinkFeed() view returns (address)",
  "function priceThreshold() view returns (uint256)",
  "function priceThresholdKind() view returns (uint8)",
  "function priceUpperBound() view returns (uint256)",
  "function winningOutcomeIndex() view returns (uint256)",
  "function settledOraclePrice() view returns (int256)",
  "function settlementTimestamp() view returns (uint256)",
  "function redemptionRate() view returns (uint256)",
]);

const FEED_ABI = parseAbi(["function decimals() view returns (uint8)"]);

export type MarketListItem = {
  address: `0x${string}`;
  kind: UiMarketKind;
  outcomes: number;
  outcomeLabels: string[];
  title: string;
  description: string;
  imageUrl: string;
  stakeEnds: string;
  resolveAfter: string;
  stakeEndUnix: number;
  resolveAfterUnix: number;
  marketState: number;
  stateLabel: string;
  /** Sum of `realPool` / collateral held — liquidity in the market (TVL). */
  poolTvl: string;
  /** Cumulative buy+sell notional from subgraph trades. */
  tradeVolume: string;
  chancePct: number;
  collateralAddress: `0x${string}`;
  collateralDecimals: number;
  priceBinByOutcome?: string[];
  outcomeChancePcts: number[];
  slug?: string;
  categories?: string[];
  nadMarket?: import("@/lib/nad/types").NadMarketConfig;
  /** Public resolution reference links from market metadata (event markets). */
  resolutionSources?: ResolutionSource[];
};

function fmtTs(value: bigint) {
  const ms = Number(value) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  return new Date(ms).toLocaleString();
}

function stateLabel(state: number) {
  switch (state) {
    case 0:
      return "Open";
    case 1:
      return "Awaiting resolution";
    case 2:
      return "Settled";
    case 3:
      return "Cancelled";
    default:
      return `State ${state}`;
  }
}

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, v));
}

function fmtUsdBin(value: bigint): string {
  const n = Number(formatUnits(value, 8));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtTsDetail(value: bigint) {
  const ms = Number(value) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleString();
}

export type MarketDetailItem = MarketListItem & {
  winningOutcomeIndex: number | null;
  settledOraclePrice: bigint;
  settlementTimestamp: number;
  redemptionRate: bigint;
  priceThreshold: bigint;
  priceThresholdKind: number;
  priceUpperBound: bigint;
  chainlinkFeed: `0x${string}`;
  feedDecimals: number;
  usesBins: boolean;
};

/** JSON-safe market detail for API responses. */
export type MarketDetailDto = Omit<
  MarketDetailItem,
  "settledOraclePrice" | "redemptionRate" | "priceThreshold" | "priceUpperBound"
> & {
  settledOraclePrice: string;
  redemptionRate: string;
  priceThreshold: string;
  priceUpperBound: string;
};

export function serializeMarketDetail(market: MarketDetailItem): MarketDetailDto {
  return {
    ...market,
    settledOraclePrice: market.settledOraclePrice.toString(),
    redemptionRate: market.redemptionRate.toString(),
    priceThreshold: market.priceThreshold.toString(),
    priceUpperBound: market.priceUpperBound.toString(),
  };
}

export function parseMarketDetailDto(dto: MarketDetailDto): MarketDetailItem {
  return {
    ...dto,
    settledOraclePrice: BigInt(dto.settledOraclePrice),
    redemptionRate: BigInt(dto.redemptionRate),
    priceThreshold: BigInt(dto.priceThreshold),
    priceUpperBound: BigInt(dto.priceUpperBound),
  };
}

/** Card fields from the markets grid override detail — same source as trade modal. */
export function mergeListItemIntoDetail(
  listItem: MarketListItem,
  detail: MarketDetailItem,
): MarketDetailItem {
  return {
    ...detail,
    title: listItem.title,
    description: listItem.description,
    imageUrl: listItem.imageUrl,
    slug: listItem.slug ?? detail.slug,
    outcomeLabels: listItem.outcomeLabels,
    categories: listItem.categories ?? detail.categories,
    outcomeChancePcts: listItem.outcomeChancePcts,
    chancePct: listItem.chancePct,
    poolTvl: listItem.poolTvl,
    tradeVolume: listItem.tradeVolume,
    stakeEnds: listItem.stakeEnds,
    resolveAfter: listItem.resolveAfter,
    stakeEndUnix: listItem.stakeEndUnix,
    resolveAfterUnix: listItem.resolveAfterUnix,
    priceBinByOutcome: listItem.priceBinByOutcome ?? detail.priceBinByOutcome,
    nadMarket: listItem.nadMarket ?? detail.nadMarket,
    resolutionSources: listItem.resolutionSources ?? detail.resolutionSources,
  };
}

/** Detail page: grid card metadata + settlement extras (same card data as trade modal). */
export async function loadMarketDetailForPage(
  marketAddress: `0x${string}`,
): Promise<MarketDetailItem> {
  const detail = await loadMarketDetail(marketAddress);
  try {
    const list = await loadMarketsList();
    const hit = list.find((m) => m.address.toLowerCase() === marketAddress.toLowerCase());
    if (hit) return mergeListItemIntoDetail(hit, detail);
  } catch {
    // list unavailable — return detail row metadata
  }
  return detail;
}

/** Same metadata + card fields as the markets grid; adds settlement extras for detail view. */
export async function loadMarketDetail(marketAddress: `0x${string}`): Promise<MarketDetailItem> {
  const publicClient = deploymentPublicClient;
  const code = await publicClient.getBytecode({ address: marketAddress });
  if (!code || code === "0x") {
    throw new Error(`Market contract not found for ${marketAddress}`);
  }

  const row = await loadMarketRow(marketAddress, { requireListable: false });
  if (!row) {
    throw new Error(`Incomplete market data for ${marketAddress}`);
  }

  const zero = "0x0000000000000000000000000000000000000000" as `0x${string}`;
  let winningRaw = BigInt(0);
  let settledRaw = BigInt(0);
  let settlementTs = BigInt(0);
  let redemptionRate = BigInt(0);
  let priceThreshold = BigInt(0);
  let priceKind = 0;
  let priceUpper = BigInt(0);
  let feed: `0x${string}` = zero;

  try {
    const settlement = await publicClient.multicall({
      contracts: [
        { address: marketAddress, abi: MARKET_ABI, functionName: "winningOutcomeIndex" },
        { address: marketAddress, abi: MARKET_ABI, functionName: "settledOraclePrice" },
        { address: marketAddress, abi: MARKET_ABI, functionName: "settlementTimestamp" },
        { address: marketAddress, abi: MARKET_ABI, functionName: "redemptionRate" },
        { address: marketAddress, abi: MARKET_ABI, functionName: "priceThreshold" },
        { address: marketAddress, abi: MARKET_ABI, functionName: "priceThresholdKind" },
        { address: marketAddress, abi: MARKET_ABI, functionName: "priceUpperBound" },
        { address: marketAddress, abi: MARKET_ABI, functionName: "chainlinkFeed" },
      ],
    });

    winningRaw = (settlement[0]?.result as bigint | undefined) ?? BigInt(0);
    settledRaw = (settlement[1]?.result as bigint | undefined) ?? BigInt(0);
    settlementTs = (settlement[2]?.result as bigint | undefined) ?? BigInt(0);
    redemptionRate = (settlement[3]?.result as bigint | undefined) ?? BigInt(0);
    priceThreshold = (settlement[4]?.result as bigint | undefined) ?? BigInt(0);
    priceKind = Number(settlement[5]?.result ?? 0);
    priceUpper = (settlement[6]?.result as bigint | undefined) ?? BigInt(0);
    feed = (settlement[7]?.result as `0x${string}` | undefined) ?? zero;
  } catch {
    // Settlement reads are optional — card metadata from loadMarketRow still returns.
  }

  const st = row.marketState;
  const outcomeCount = row.outcomes;
  const isPrice = row.kind === "Price";
  const wr = winningRaw;
  const winIdx = st === 2 && wr < BigInt(outcomeCount) ? Number(wr) : null;

  let feedDec = 8;
  if (isPrice && feed !== zero) {
    try {
      feedDec = Number(
        await publicClient.readContract({
          address: feed,
          abi: FEED_ABI,
          functionName: "decimals",
        }),
      );
    } catch {
      feedDec = 8;
    }
  }

  return {
    ...row,
    winningOutcomeIndex: winIdx,
    settledOraclePrice: settledRaw,
    settlementTimestamp: Number(settlementTs),
    redemptionRate,
    priceThreshold,
    priceThresholdKind: priceKind,
    priceUpperBound: priceUpper,
    chainlinkFeed: feed,
    feedDecimals: feedDec,
    usesBins: Boolean(row.priceBinByOutcome && row.priceBinByOutcome.length > 0),
  };
}

type LoadMarketRowOptions = {
  /** When true (default), skip markets without valid IPFS cover metadata (markets grid). */
  requireListable?: boolean;
  /** Price bin labels are only needed on detail/trade — skip on markets grid. */
  includePriceBins?: boolean;
};

type MarketChainSlice = {
  kind: number;
  uri: string;
  stake: bigint;
  resolveAfter: bigint;
  outcomeCount: number;
  state: number;
  dec: number;
  collateralAddress: `0x${string}`;
  /** Set when state === 2 (settled). */
  winningOutcomeIndex?: number | null;
};

type MarketLoadEntry = {
  address: `0x${string}`;
  subgraph: SubgraphMarketIndex | null;
  isFpmm: boolean;
};

function buildMarketListItem(
  address: `0x${string}`,
  slice: MarketChainSlice,
  md: IpfsMarketMetadata | null,
  poolTvlRaw: bigint,
  priceResults: bigint[],
  priceBinByOutcome?: string[],
  tradeVolumeRaw: bigint = 0n,
): MarketListItem {
  const isPrice = isPriceMarketKind(slice.kind);
  const uiKind = uiMarketKindForDisplay(slice.kind, md as Record<string, unknown> | null);
  const outcomeCount = slice.outcomeCount;

  const fallbackLabels = Array.from({ length: outcomeCount }, (_, i) => `Outcome ${i + 1}`);
  const labelsFromIpfs =
    md?.outcomes && md.outcomes.length > 0
      ? md.outcomes.filter((x): x is string => typeof x === "string")
      : [];
  const safeOutcomeLabels = labelsFromIpfs.length > 0 ? labelsFromIpfs : fallbackLabels;

  let leftPct = outcomeCount >= 2 ? 50 : Math.max(1, Math.round(100 / Math.max(1, outcomeCount)));
  let outcomeChancePcts = Array.from({ length: outcomeCount }, (_, i) =>
    i === 0 ? leftPct : Math.round((100 - leftPct) / Math.max(1, outcomeCount - 1)),
  );
  const winIdx = slice.winningOutcomeIndex;
  // Settled: show result (winner 100%), not stale pool odds (often still ~50/50 after even seed).
  if (slice.state === 2 && winIdx != null && winIdx >= 0 && winIdx < outcomeCount) {
    outcomeChancePcts = Array.from({ length: outcomeCount }, (_, i) => (i === winIdx ? 100 : 0));
    leftPct = outcomeChancePcts[0] ?? 0;
  } else if (priceResults.length === outcomeCount) {
    outcomeChancePcts = priceResults.map((p) => clampPct(Number(formatUnits(p, 18)) * 100));
    leftPct = outcomeChancePcts[0] ?? leftPct;
  }

  const launchpadRaw = launchpadMarketFromMetadata(md as Record<string, unknown> | null);
  const nadMarket = launchpadMarketForDisplay(md as Record<string, unknown> | null);

  return {
    address,
    kind: uiKind,
    outcomes: outcomeCount,
    outcomeLabels: safeOutcomeLabels,
    slug: md?.slug?.trim() || undefined,
    title:
      md?.title?.trim() ||
      md?.question?.trim() ||
      `${isPrice ? "Price" : uiKind} market`,
    description: md?.description?.trim() || "No description provided.",
    imageUrl:
      ipfsToHttp(md?.image?.trim() || "") ||
      launchpadRaw?.tokens?.[0]?.imageUri?.trim() ||
      md?.nadMarket?.tokens?.[0]?.imageUri?.trim() ||
      "",
    stakeEnds: fmtTs(slice.stake),
    resolveAfter: fmtTs(slice.resolveAfter),
    stakeEndUnix: Number(slice.stake),
    resolveAfterUnix: Number(slice.resolveAfter),
    marketState: slice.state,
    stateLabel: stateLabel(slice.state),
    poolTvl: Number(formatUnits(poolTvlRaw, slice.dec)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    }),
    tradeVolume: Number(formatUnits(tradeVolumeRaw, slice.dec)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    }),
    chancePct: leftPct,
    outcomeChancePcts,
    categories:
      md?.categories
        ?.filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean) ?? [],
    nadMarket,
    collateralAddress: slice.collateralAddress,
    collateralDecimals: slice.dec,
    priceBinByOutcome,
    resolutionSources: normalizeResolutionSources(md?.resolutionSources),
  };
}

async function multicallChunked(
  contracts: readonly {
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }[],
  chunkSize = 250,
): Promise<{ result?: unknown; status: string }[]> {
  const publicClient = deploymentPublicClient;
  if (contracts.length === 0) return [];
  const out: { result?: unknown; status: string }[] = [];
  for (let i = 0; i < contracts.length; i += chunkSize) {
    const chunk = contracts.slice(i, i + chunkSize);
    const batch = await publicClient.multicall({
      contracts: chunk as Parameters<typeof publicClient.multicall>[0]["contracts"],
    });
    out.push(...(batch as { result?: unknown; status: string }[]));
  }
  return out;
}

async function listFactoryMarkets(
  factory: `0x${string}`,
  isFpmm: boolean,
): Promise<MarketLoadEntry[]> {
  const publicClient = deploymentPublicClient;
  const total = Number(
    await publicClient.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "marketsLength",
    }),
  );
  if (total <= 0) return [];

  const addressReads = await publicClient.multicall({
    contracts: Array.from({ length: total }, (_, idx) => ({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "markets" as const,
      args: [BigInt(total - 1 - idx)] as const,
    })),
  });

  return addressReads
    .map((r) => r.result as `0x${string}` | undefined)
    .filter((a): a is `0x${string}` => Boolean(a))
    .map((address) => ({ address, subgraph: null, isFpmm }));
}

async function resolveMarketEntries(): Promise<MarketLoadEntry[]> {
  const fromSubgraph = await fetchMarketsFromSubgraph(500);
  if (fromSubgraph.ok && fromSubgraph.markets.length > 0) {
    return fromSubgraph.markets
      .map((m) => ({
        address: m.id.trim() as `0x${string}`,
        subgraph: m,
        isFpmm: m.mechanism === "fpmm",
      }))
      .filter((e) => /^0x[a-fA-F0-9]{40}$/i.test(e.address));
  }

  // Empty or failed subgraph — fall back to factory so new markets still appear.
  if (fromSubgraph.ok && fromSubgraph.markets.length === 0) {
    console.warn("[load-markets] subgraph returned 0 markets; scanning factory");
  }

  const entries: MarketLoadEntry[] = [];
  const fpmm = fpmmFactoryAddress();
  try {
    if (fpmm) {
      entries.push(...(await listFactoryMarkets(fpmm, true)));
    }
  } catch (error) {
    console.warn("[load-markets] factory scan failed:", error instanceof Error ? error.message : error);
    return [];
  }

  const byAddr = new Map<string, MarketLoadEntry>();
  for (const e of entries) {
    byAddr.set(e.address.toLowerCase(), e);
  }
  return [...byAddr.values()];
}

async function loadMarketsListUncached(): Promise<MarketListItem[]> {
  const entries = await resolveMarketEntries();
  if (entries.length === 0) return [];

  const phase1Contracts = entries.flatMap(({ address, subgraph }) => {
    if (subgraph) {
      return [
        { address, abi: MARKET_ABI, functionName: "numOutcomes" as const },
        { address, abi: MARKET_ABI, functionName: "collateralDecimals" as const },
      ];
    }
    return [
      { address, abi: MARKET_ABI, functionName: "marketKind" as const },
      { address, abi: MARKET_ABI, functionName: "metadataURI" as const },
      { address, abi: MARKET_ABI, functionName: "stakeEndTimestamp" as const },
      { address, abi: MARKET_ABI, functionName: "resolveAfterTimestamp" as const },
      { address, abi: MARKET_ABI, functionName: "numOutcomes" as const },
      { address, abi: MARKET_ABI, functionName: "state" as const },
      { address, abi: MARKET_ABI, functionName: "collateralDecimals" as const },
      { address, abi: MARKET_ABI, functionName: "collateralAddress" as const },
    ];
  });

  const phase1 = await multicallChunked(phase1Contracts);

  const slices: (MarketChainSlice | null)[] = [];
  let phase1Idx = 0;
  for (const entry of entries) {
    const subgraph = entry.subgraph;
    if (subgraph) {
      const outcomes = phase1[phase1Idx++]?.result as number | undefined;
      const dec = phase1[phase1Idx++]?.result as number | undefined;
      const collateralRaw = subgraph.collateralToken?.trim();
      if (
        outcomes === undefined ||
        dec === undefined ||
        !collateralRaw ||
        !/^0x[a-fA-F0-9]{40}$/.test(collateralRaw)
      ) {
        slices.push(null);
        continue;
      }
      slices.push({
        kind: subgraph.kind,
        uri: subgraph.metadataURI?.trim() ?? "",
        stake: BigInt(subgraph.stakeEndTimestamp),
        resolveAfter: BigInt(subgraph.resolveAfterTimestamp),
        outcomeCount: Number(outcomes),
        state: subgraph.state,
        dec: Number(dec),
        collateralAddress: collateralRaw as `0x${string}`,
      });
      continue;
    }

    const kind = phase1[phase1Idx++]?.result as bigint | undefined;
    const uri = String(phase1[phase1Idx++]?.result ?? "");
    const stake = phase1[phase1Idx++]?.result as bigint | undefined;
    const resolveAfter = phase1[phase1Idx++]?.result as bigint | undefined;
    const outcomes = phase1[phase1Idx++]?.result as number | undefined;
    const state = phase1[phase1Idx++]?.result as number | undefined;
    const dec = phase1[phase1Idx++]?.result as number | undefined;
    const collateralAddress = phase1[phase1Idx++]?.result as `0x${string}` | undefined;

    if (
      kind === undefined ||
      stake === undefined ||
      resolveAfter === undefined ||
      outcomes === undefined ||
      state === undefined ||
      dec === undefined ||
      !collateralAddress
    ) {
      slices.push(null);
      continue;
    }

    slices.push({
      kind: Number(kind),
      uri,
      stake,
      resolveAfter,
      outcomeCount: Number(outcomes),
      state: Number(state),
      dec: Number(dec),
      collateralAddress,
    });
  }

  const uniqueUris = [
    ...new Set(slices.map((s) => s?.uri.trim()).filter((u): u is string => Boolean(u))),
  ];
  const mdByUri = new Map<string, IpfsMarketMetadata | null>();
  await mapPool(uniqueUris, 20, async (uri) => {
    mdByUri.set(uri, await fetchIpfsMetadata(uri));
  });

  const phase2Contracts = entries.flatMap((entry, i) => {
    const slice = slices[i];
    if (!slice || slice.outcomeCount <= 0) return [];
    // Prices + optional winner — TVL uses collateral balanceOf(market), not sum of outcome pools.
    const priceCalls = Array.from({ length: slice.outcomeCount }, (_, o) => ({
      address: entry.address,
      abi: MARKET_ABI,
      functionName: "priceOf" as const,
      args: [o] as const,
    }));
    if (slice.state === 2) {
      return [
        ...priceCalls,
        {
          address: entry.address,
          abi: MARKET_ABI,
          functionName: "winningOutcomeIndex" as const,
        },
      ];
    }
    return priceCalls;
  });

  const tvlContracts = entries.flatMap((entry, i) => {
    const slice = slices[i];
    if (!slice) return [];
    return [marketTvlBalanceCall(entry.address, slice.collateralAddress)];
  });

  const volumePromise = fetchMarketVolumesFromSubgraph(entries.map((e) => e.address));

  const [phase2, tvlReads, volumeByMarket] = await Promise.all([
    phase2Contracts.length ? multicallChunked(phase2Contracts) : Promise.resolve([]),
    tvlContracts.length ? multicallChunked(tvlContracts) : Promise.resolve([]),
    volumePromise,
  ]);

  const rows: MarketListItem[] = [];
  let phase2Idx = 0;
  let tvlIdx = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const slice = slices[i];
    if (!slice) continue;

    const md = slice.uri ? (mdByUri.get(slice.uri) ?? null) : null;
    const launchpadRaw = launchpadMarketFromMetadata(md as Record<string, unknown> | null);
    const listable = isListableMarket(slice.uri, md?.image, launchpadRaw ?? md?.nadMarket);
    // Lighthouse public gateway is premium-only (402). Still list markets when IPFS is down
    // so the grid is not empty — cards use fallback title until metadata loads.
    const degradedListable = !listable && isValidMetadataUri(slice.uri);
    if (!listable && !degradedListable) {
      phase2Idx += slice.outcomeCount + (slice.state === 2 ? 1 : 0);
      tvlIdx += 1;
      continue;
    }

    const priceResults: bigint[] = [];
    for (let o = 0; o < slice.outcomeCount; o += 1) {
      const price = phase2[phase2Idx++]?.result as bigint | undefined;
      if (price !== undefined) priceResults.push(price);
    }
    if (slice.state === 2) {
      const winRaw = phase2[phase2Idx++]?.result as bigint | undefined;
      if (winRaw !== undefined && winRaw < BigInt(slice.outcomeCount)) {
        slice.winningOutcomeIndex = Number(winRaw);
      }
    }

    const poolTvlRaw = (tvlReads[tvlIdx++]?.result as bigint | undefined) ?? BigInt(0);
    const tradeVolumeRaw = volumeByMarket.get(entry.address.toLowerCase()) ?? 0n;

    rows.push(
      buildMarketListItem(entry.address, slice, md, poolTvlRaw, priceResults, undefined, tradeVolumeRaw),
    );
  }

  return rows;
}

const loadMarketsListCached = unstable_cache(
  loadMarketsListUncached,
  ["zedkr-markets-list"],
  { revalidate: 20 },
);

export async function loadMarketsList(opts?: { force?: boolean }): Promise<MarketListItem[]> {
  if (opts?.force) {
    return loadMarketsListUncached();
  }
  const rows = await loadMarketsListCached();
  // Never serve a cached empty list — a transient subgraph/IPFS blip would hide all markets for 20s.
  if (rows.length === 0) {
    return loadMarketsListUncached();
  }
  return rows;
}

async function loadMarketRow(
  marketAddress: `0x${string}`,
  options: LoadMarketRowOptions = {},
): Promise<MarketListItem | null> {
  const { requireListable = true, includePriceBins = true } = options;
  const publicClient = deploymentPublicClient;

  const base = await publicClient.multicall({
    contracts: [
      { address: marketAddress, abi: MARKET_ABI, functionName: "marketKind" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "metadataURI" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "stakeEndTimestamp" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "resolveAfterTimestamp" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "numOutcomes" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "state" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "collateralDecimals" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "collateralAddress" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "winningOutcomeIndex" },
    ],
  });

  const kind = base[0]?.result as bigint | undefined;
  const uri = String(base[1]?.result ?? "");
  const stake = base[2]?.result as bigint | undefined;
  const resolveAfter = base[3]?.result as bigint | undefined;
  const outcomes = base[4]?.result as number | undefined;
  const state = base[5]?.result as number | undefined;
  const collateralDecimals = base[6]?.result as number | undefined;
  const collateralAddress = base[7]?.result as `0x${string}` | undefined;
  const winningRaw = base[8]?.result as bigint | undefined;

  if (
    kind === undefined ||
    stake === undefined ||
    resolveAfter === undefined ||
    outcomes === undefined ||
    state === undefined ||
    collateralDecimals === undefined ||
    !collateralAddress
  ) {
    throw new Error(`Incomplete market data for ${marketAddress}`);
  }

  const outcomeCount = Number(outcomes);
  const dec = Number(collateralDecimals);
  const isPrice = isPriceMarketKind(Number(kind));

  const outcomeContracts = Array.from({ length: outcomeCount }, (_, i) => ({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "priceOf" as const,
    args: [i] as const,
  }));

  const [md, outcomeReads, tvlRead, volumeByMarket] = await Promise.all([
    fetchIpfsMetadata(uri),
    outcomeContracts.length
      ? publicClient.multicall({ contracts: outcomeContracts })
      : Promise.resolve([]),
    publicClient.multicall({
      contracts: [marketTvlBalanceCall(marketAddress, collateralAddress)],
    }),
    fetchMarketVolumesFromSubgraph([marketAddress]),
  ]);

  if (requireListable && !isListableMarket(uri, md?.image, launchpadMarketFromMetadata(md as Record<string, unknown> | null) ?? md?.nadMarket)) {
    // Allow degraded listing when URI is valid but IPFS cover failed (same as markets grid).
    if (!isValidMetadataUri(uri)) {
      return null;
    }
  }

  const poolTvlRaw = (tvlRead[0]?.result as bigint | undefined) ?? BigInt(0);
  const priceResults: bigint[] = [];
  for (let i = 0; i < outcomeCount; i += 1) {
    const price = outcomeReads[i]?.result as bigint | undefined;
    if (price !== undefined) priceResults.push(price);
  }

  let priceBinByOutcome: string[] | undefined;
  if (includePriceBins && isPrice) {
    try {
      const binContracts = Array.from({ length: outcomeCount }, (_, i) => [
        { address: marketAddress, abi: MARKET_ABI, functionName: "priceBinLower" as const, args: [BigInt(i)] as const },
        { address: marketAddress, abi: MARKET_ABI, functionName: "priceBinUpper" as const, args: [BigInt(i)] as const },
      ]).flat();
      const binReads = await publicClient.multicall({ contracts: binContracts });
      priceBinByOutcome = Array.from({ length: outcomeCount }, (_, i) => {
        const lo = binReads[i * 2]?.result as bigint | undefined;
        const hi = binReads[i * 2 + 1]?.result as bigint | undefined;
        if (lo === undefined || hi === undefined) return `Outcome ${i + 1}`;
        return `$${fmtUsdBin(lo)} — $${fmtUsdBin(hi)}`;
      });
    } catch {
      priceBinByOutcome = undefined;
    }
  }

  const stateNum = Number(state);
  const winIdx =
    stateNum === 2 && winningRaw !== undefined && winningRaw < BigInt(outcomeCount)
      ? Number(winningRaw)
      : null;

  const slice: MarketChainSlice = {
    kind: Number(kind),
    uri,
    stake,
    resolveAfter,
    outcomeCount,
    state: stateNum,
    dec,
    collateralAddress,
    winningOutcomeIndex: winIdx,
  };

  return buildMarketListItem(
    marketAddress,
    slice,
    md,
    poolTvlRaw,
    priceResults,
    priceBinByOutcome,
    volumeByMarket.get(marketAddress.toLowerCase()) ?? 0n,
  );
}

/** Single market card row (e.g. wallet launches). Defaults to including even if IPFS cover is missing. */
export async function loadMarketListItem(
  marketAddress: `0x${string}`,
  options: LoadMarketRowOptions = {},
): Promise<MarketListItem | null> {
  return loadMarketRow(marketAddress, {
    requireListable: false,
    includePriceBins: false,
    ...options,
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }

  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

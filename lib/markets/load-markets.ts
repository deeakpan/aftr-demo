import { formatUnits, parseAbi } from "viem";
import deployment from "@/lib/deployment";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import { fetchIpfsMetadata, ipfsToHttp } from "@/lib/ipfs-metadata";
import { isListableMarket } from "@/lib/market-metadata";

const FACTORY_ADDRESS = deployment.contracts.MondaloreParimutuelMarketFactory as `0x${string}`;

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
  kind: "Event" | "Price";
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
  poolTvl: string;
  chancePct: number;
  collateralAddress: `0x${string}`;
  collateralDecimals: number;
  priceBinByOutcome?: string[];
  outcomeChancePcts: number[];
  slug?: string;
  categories?: string[];
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
    stakeEnds: listItem.stakeEnds,
    resolveAfter: listItem.resolveAfter,
    stakeEndUnix: listItem.stakeEndUnix,
    resolveAfterUnix: listItem.resolveAfterUnix,
    priceBinByOutcome: listItem.priceBinByOutcome ?? detail.priceBinByOutcome,
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
};

async function loadMarketRow(
  marketAddress: `0x${string}`,
  options: LoadMarketRowOptions = {},
): Promise<MarketListItem | null> {
  const { requireListable = true } = options;
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
  const isPrice = Number(kind) === 0;

  const outcomeContracts = Array.from({ length: outcomeCount }, (_, i) => [
    { address: marketAddress, abi: MARKET_ABI, functionName: "realPool" as const, args: [BigInt(i)] as const },
    { address: marketAddress, abi: MARKET_ABI, functionName: "priceOf" as const, args: [i] as const },
  ]).flat();

  const [md, outcomeReads] = await Promise.all([
    fetchIpfsMetadata(uri),
    outcomeContracts.length
      ? publicClient.multicall({ contracts: outcomeContracts })
      : Promise.resolve([]),
  ]);

  if (requireListable && !isListableMarket(uri, md?.image)) {
    return null;
  }

  let poolTvlRaw = BigInt(0);
  const priceResults: bigint[] = [];
  for (let i = 0; i < outcomeCount; i += 1) {
    const pool = outcomeReads[i * 2]?.result as bigint | undefined;
    const price = outcomeReads[i * 2 + 1]?.result as bigint | undefined;
    if (pool !== undefined) poolTvlRaw += pool;
    if (price !== undefined) priceResults.push(price);
  }

  const fallbackLabels = Array.from({ length: outcomeCount }, (_, i) => `Outcome ${i + 1}`);
  const labelsFromIpfs =
    md?.outcomes && md.outcomes.length > 0
      ? md.outcomes.filter((x): x is string => typeof x === "string")
      : [];
  const safeOutcomeLabels = labelsFromIpfs.length > 0 ? labelsFromIpfs : fallbackLabels;

  let priceBinByOutcome: string[] | undefined;
  if (isPrice) {
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

  let leftPct = outcomeCount >= 2 ? 50 : Math.max(1, Math.round(100 / Math.max(1, outcomeCount)));
  let outcomeChancePcts = Array.from({ length: outcomeCount }, (_, i) =>
    i === 0 ? leftPct : Math.round((100 - leftPct) / Math.max(1, outcomeCount - 1)),
  );
  if (priceResults.length === outcomeCount) {
    outcomeChancePcts = priceResults.map((p) => clampPct(Number(formatUnits(p, 18)) * 100));
    leftPct = outcomeChancePcts[0] ?? leftPct;
  }

  return {
    address: marketAddress,
    kind: isPrice ? "Price" : "Event",
    outcomes: outcomeCount,
    outcomeLabels: safeOutcomeLabels,
    slug: md?.slug?.trim() || undefined,
    title:
      md?.title?.trim() ||
      md?.question?.trim() ||
      `${isPrice ? "Price" : "Event"} market`,
    description: md?.description?.trim() || "No description provided.",
    imageUrl: ipfsToHttp(md?.image?.trim() || ""),
    stakeEnds: fmtTs(stake),
    resolveAfter: fmtTs(resolveAfter),
    stakeEndUnix: Number(stake),
    resolveAfterUnix: Number(resolveAfter),
    marketState: Number(state),
    stateLabel: stateLabel(Number(state)),
    poolTvl: Number(formatUnits(poolTvlRaw, dec)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    }),
    chancePct: leftPct,
    outcomeChancePcts,
    categories:
      md?.categories
        ?.filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean) ?? [],
    collateralAddress,
    collateralDecimals: dec,
    priceBinByOutcome,
  };
}

export async function loadMarketsList(): Promise<MarketListItem[]> {
  const publicClient = deploymentPublicClient;

  const total = Number(
    await publicClient.readContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "marketsLength",
    }),
  );

  if (total <= 0) return [];

  const addressReads = await publicClient.multicall({
    contracts: Array.from({ length: total }, (_, idx) => ({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "markets" as const,
      args: [BigInt(total - 1 - idx)] as const,
    })),
  });

  const addresses = addressReads
    .map((r) => r.result as `0x${string}` | undefined)
    .filter((a): a is `0x${string}` => Boolean(a));

  const rows: MarketListItem[] = [];
  for (const marketAddress of addresses) {
    const row = await loadMarketRow(marketAddress);
    if (row) rows.push(row);
  }
  return rows;
}

import { formatUnits, parseAbi } from "viem";
import deployment from "@/deployments/baseSepolia-84532.json";
import { deploymentPublicClient } from "@/lib/deployment-public-client";

const FACTORY_ADDRESS = deployment.contracts.AFTRParimutuelMarketFactory as `0x${string}`;

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
]);

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

type IpfsMetadata = {
  title?: string;
  description?: string;
  image?: string;
  outcomes?: string[];
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

function ipfsToHttp(uri: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.lighthouse.storage/ipfs/${uri.replace("ipfs://", "")}`;
  }
  return uri;
}

function fmtUsdBin(value: bigint): string {
  const n = Number(formatUnits(value, 8));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

async function fetchIpfsMetadata(uri: string): Promise<IpfsMetadata | null> {
  const httpUrl = ipfsToHttp(uri);
  if (!httpUrl) return null;
  try {
    const res = await fetch(httpUrl, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as IpfsMetadata;
  } catch {
    return null;
  }
}

async function loadMarketRow(marketAddress: `0x${string}`): Promise<MarketListItem> {
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

  const md = await fetchIpfsMetadata(uri);
  const outcomeCount = Number(outcomes);
  const dec = Number(collateralDecimals);
  const isPrice = Number(kind) === 0;

  const outcomeContracts = Array.from({ length: outcomeCount }, (_, i) => [
    { address: marketAddress, abi: MARKET_ABI, functionName: "realPool" as const, args: [BigInt(i)] as const },
    { address: marketAddress, abi: MARKET_ABI, functionName: "priceOf" as const, args: [i] as const },
  ]).flat();

  const outcomeReads = outcomeContracts.length
    ? await publicClient.multicall({ contracts: outcomeContracts })
    : [];

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
    title: md?.title?.trim() || `${isPrice ? "Price" : "Event"} market`,
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
    rows.push(await loadMarketRow(marketAddress));
  }
  return rows;
}

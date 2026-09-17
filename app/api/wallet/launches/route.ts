import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress, parseAbi, type Address } from "viem";
import { fetchMarketsByCreator, type SubgraphCreatorMarket } from "@/lib/subgraph/creator-markets";
import { loadMarketListItem, type MarketListItem } from "@/lib/markets/load-markets";
import { fpmmFactoryAddress } from "@/lib/market-factory";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import { uiMarketKindForDisplay } from "@/lib/launchpad-display";

export const dynamic = "force-dynamic";

const FACTORY_ABI = parseAbi([
  "function marketsLength() view returns (uint256)",
  "function markets(uint256) view returns (address)",
]);

const MARKET_CREATOR_ABI = parseAbi([
  "function creator() view returns (address)",
  "function marketKind() view returns (uint8)",
  "function state() view returns (uint8)",
  "function stakeEndTimestamp() view returns (uint256)",
  "function resolveAfterTimestamp() view returns (uint256)",
  "function numOutcomes() view returns (uint8)",
  "function collateralAddress() view returns (address)",
  "function collateralDecimals() view returns (uint8)",
]);

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

function stubFromSubgraph(m: SubgraphCreatorMarket): MarketListItem {
  const address = m.id.trim() as `0x${string}`;
  const stakeEndUnix = Number(m.stakeEndTimestamp || 0);
  const resolveAfterUnix = Number(m.resolveAfterTimestamp || 0);
  const kind = uiMarketKindForDisplay(Number(m.kind), null);
  return {
    address,
    kind,
    outcomes: 2,
    outcomeLabels: ["Yes", "No"],
    title: `${kind} market`,
    description: "",
    imageUrl: "",
    stakeEnds: stakeEndUnix > 0 ? new Date(stakeEndUnix * 1000).toLocaleString() : "—",
    resolveAfter: resolveAfterUnix > 0 ? new Date(resolveAfterUnix * 1000).toLocaleString() : "—",
    stakeEndUnix,
    resolveAfterUnix,
    marketState: Number(m.state ?? 0),
    stateLabel: Number(m.state) === 2 ? "Settled" : Number(m.state) === 0 ? "Open" : "—",
    poolTvl: "—",
    tradeVolume: "—",
    chancePct: 50,
    collateralAddress: (m.collateralToken ||
      "0x0000000000000000000000000000000000000000") as `0x${string}`,
    collateralDecimals: 6,
    outcomeChancePcts: [50, 50],
  };
}

async function factoryMarketsByCreator(creator: Address): Promise<`0x${string}`[]> {
  const factory = fpmmFactoryAddress();
  if (!factory) return [];
  const publicClient = deploymentPublicClient;
  const total = Number(
    await publicClient.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "marketsLength",
    }),
  );
  if (total <= 0) return [];

  const addresses = await publicClient.multicall({
    contracts: Array.from({ length: total }, (_, idx) => ({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "markets" as const,
      args: [BigInt(total - 1 - idx)] as const,
    })),
  });

  const marketAddrs = addresses
    .map((r) => r.result as `0x${string}` | undefined)
    .filter((a): a is `0x${string}` => Boolean(a));

  const creators = await publicClient.multicall({
    contracts: marketAddrs.map((address) => ({
      address,
      abi: MARKET_CREATOR_ABI,
      functionName: "creator" as const,
    })),
  });

  const want = creator.toLowerCase();
  return marketAddrs.filter((addr, i) => {
    const c = creators[i]?.result as string | undefined;
    return Boolean(c && c.toLowerCase() === want);
  });
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const creator = getAddress(wallet);
  const indexed = await fetchMarketsByCreator(creator, 100);

  let marketIds: string[] = [];
  let subgraphById = new Map<string, SubgraphCreatorMarket>();
  let usedFactoryFallback = false;

  if (indexed.ok && indexed.markets.length > 0) {
    marketIds = indexed.markets.map((m) => m.id);
    subgraphById = new Map(indexed.markets.map((m) => [m.id.toLowerCase(), m]));
  } else {
    // Indexer empty/down or lagging after create — scan factory by creator().
    try {
      const onChain = await factoryMarketsByCreator(creator);
      marketIds = onChain;
      usedFactoryFallback = true;
      if (indexed.ok) {
        subgraphById = new Map(indexed.markets.map((m) => [m.id.toLowerCase(), m]));
      }
    } catch (err) {
      console.warn("[launches] factory fallback failed", err instanceof Error ? err.message : err);
      if (!indexed.ok) {
        return NextResponse.json(
          {
            markets: [] as MarketListItem[],
            wallet: creator.toLowerCase(),
            unavailable: true,
            reason: indexed.reason,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    }
  }

  const loaded = await mapPool(marketIds, 4, async (id) => {
    const address = id.trim() as `0x${string}`;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
    try {
      const item = await loadMarketListItem(address);
      if (item) return item;
    } catch (err) {
      console.warn("[launches] load failed", address, err instanceof Error ? err.message : err);
    }
    const sg = subgraphById.get(address.toLowerCase());
    return sg ? stubFromSubgraph(sg) : null;
  });

  const markets = loaded.filter((m): m is MarketListItem => m !== null);

  return NextResponse.json(
    {
      markets,
      wallet: creator.toLowerCase(),
      indexedCount: indexed.ok ? indexed.markets.length : 0,
      loadedCount: markets.length,
      factoryFallback: usedFactoryFallback,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

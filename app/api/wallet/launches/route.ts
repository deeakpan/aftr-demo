import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { fetchMarketsByCreator } from "@/lib/subgraph/creator-markets";
import { loadMarketListItem, type MarketListItem } from "@/lib/markets/load-markets";

export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const creator = getAddress(wallet);
  const indexed = await fetchMarketsByCreator(creator, 100);
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

  const loaded = await mapPool(indexed.markets, 4, async (m) => {
    const address = m.id.trim() as `0x${string}`;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
    try {
      return await loadMarketListItem(address);
    } catch {
      return null;
    }
  });

  const markets = loaded.filter((m): m is MarketListItem => m !== null);

  return NextResponse.json(
    {
      markets,
      wallet: creator.toLowerCase(),
      indexedCount: indexed.markets.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

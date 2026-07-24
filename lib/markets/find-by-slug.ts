import { loadMarketsList, type MarketListItem } from "@/lib/markets/load-markets";
import { isReservedMarketSlug, normalizeMarketSlug } from "@/lib/markets/market-url";

function matchSlug(markets: MarketListItem[], needle: string): MarketListItem | null {
  return markets.find((m) => (m.slug ?? "").trim().toLowerCase() === needle) ?? null;
}

/**
 * Resolve vanity slug → market. Tries the warm list cache first, then a forced
 * fresh load on miss (avoids "not found" when the cache was empty/stale).
 */
export async function findMarketBySlug(rawSlug: string): Promise<MarketListItem | null> {
  const slug = normalizeMarketSlug(rawSlug);
  if (!slug || isReservedMarketSlug(slug)) return null;
  const needle = slug.toLowerCase();

  const cached = await loadMarketsList();
  const fromCache = matchSlug(cached, needle);
  if (fromCache) return fromCache;

  const fresh = await loadMarketsList({ force: true });
  return matchSlug(fresh, needle);
}

export async function isMarketSlugTaken(
  rawSlug: string,
  opts?: { excludeAddress?: string },
): Promise<{ taken: boolean; address?: `0x${string}` }> {
  const slug = normalizeMarketSlug(rawSlug);
  if (!slug || isReservedMarketSlug(slug)) return { taken: true };
  const hit = await findMarketBySlug(slug);
  if (!hit) return { taken: false };
  if (
    opts?.excludeAddress &&
    hit.address.toLowerCase() === opts.excludeAddress.toLowerCase()
  ) {
    return { taken: false, address: hit.address };
  }
  return { taken: true, address: hit.address };
}

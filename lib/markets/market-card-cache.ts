import type { MarketListItem } from "@/lib/markets/load-markets";

const KEY_PREFIX = "aftr-market-card:";

export type CachedMarketCard = Pick<
  MarketListItem,
  "title" | "description" | "imageUrl" | "slug" | "outcomeLabels" | "categories"
>;

export function cacheMarketCardForDetail(address: string, card: CachedMarketCard) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`${KEY_PREFIX}${address.toLowerCase()}`, JSON.stringify(card));
  } catch {
    // quota / private mode
  }
}

export function readCachedMarketCard(address: string): CachedMarketCard | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${KEY_PREFIX}${address.toLowerCase()}`);
    if (!raw) return null;
    return JSON.parse(raw) as CachedMarketCard;
  } catch {
    return null;
  }
}

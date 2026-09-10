/** On-chain `MarketKind`: 0 = PRICE, 1 = EVENT, 2 = TOKEN (Dexscreener / Gecko + operator). */
export type UiMarketKind = "Price" | "Event" | "Nad" | "Pons" | "Token";

export const MARKET_KIND_PRICE = 0;
export const MARKET_KIND_EVENT = 1;
/** On-chain TOKEN (formerly NAD_TOKEN / PONS_TOKEN). */
export const MARKET_KIND_NAD_TOKEN = 2;
export const MARKET_KIND_TOKEN = 2;

export function marketKindFromChain(kind: number): UiMarketKind {
  if (kind === MARKET_KIND_PRICE) return "Price";
  if (kind === MARKET_KIND_TOKEN) return "Token";
  return "Event";
}

export function isPriceMarketKind(kind: number): boolean {
  return kind === MARKET_KIND_PRICE;
}

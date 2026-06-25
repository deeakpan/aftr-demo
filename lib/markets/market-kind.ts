/** On-chain `MarketKind`: 0 = PRICE, 1 = EVENT, 2 = NAD_TOKEN */
export type UiMarketKind = "Price" | "Event" | "Nad";

export const MARKET_KIND_PRICE = 0;
export const MARKET_KIND_EVENT = 1;
export const MARKET_KIND_NAD_TOKEN = 2;

export function marketKindFromChain(kind: number): UiMarketKind {
  if (kind === MARKET_KIND_PRICE) return "Price";
  if (kind === MARKET_KIND_NAD_TOKEN) return "Nad";
  return "Event";
}

export function isPriceMarketKind(kind: number): boolean {
  return kind === MARKET_KIND_PRICE;
}

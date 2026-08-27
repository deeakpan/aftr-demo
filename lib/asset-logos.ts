import { ETH_COINGECKO_LOGO, USDG_TOKEN_LOGO } from "@/lib/brand-assets";

/** CoinGecko large PNGs for crypto tickers we list. */
const CRYPTO_LOGOS: Record<string, string> = {
  BTC: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  ETH: ETH_COINGECKO_LOGO,
  LINK: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  USDG: USDG_TOKEN_LOGO,
};

/**
 * Equity / ETF logos via Financial Modeling Prep public image CDN
 * (`https://financialmodelingprep.com/image-stock/{TICKER}.png`).
 */
const EQUITY_TICKERS = new Set([
  "AAPL",
  "GOOGL",
  "MSFT",
  "AMZN",
  "META",
  "NVDA",
  "TSLA",
  "SPY",
  "QQQ",
  "AMD",
  "COIN",
  "MSTR",
]);

export function equityLogoUrl(ticker: string): string {
  return `https://financialmodelingprep.com/image-stock/${ticker.toUpperCase()}.png`;
}

/** Resolve a display logo for a feed asset symbol (BTC, AAPL, …). */
export function resolveAssetLogo(asset: string, fallbackLogo?: string | null): string {
  const key = asset.trim().toUpperCase();
  if (fallbackLogo && /^https?:\/\//i.test(fallbackLogo)) return fallbackLogo;
  if (CRYPTO_LOGOS[key]) return CRYPTO_LOGOS[key]!;
  if (EQUITY_TICKERS.has(key) || /^[A-Z]{1,5}$/.test(key)) return equityLogoUrl(key);
  return fallbackLogo?.trim() || "";
}

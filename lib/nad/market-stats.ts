import type { NadQuestionType } from "./types";

export type NadLiveStats = {
  priceUsd: number | null;
  marketCapUsd: number | null;
  holderCount: number | null;
  marketType: string;
  isOnDex: boolean;
};

function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Nad API mixes human-readable reserves with base-unit total_supply. */
function parseTokenSupply(m: Record<string, unknown>): number | null {
  const raw = toNum(m.total_supply);
  if (raw == null || raw <= 0) return null;
  if (raw >= 1e15) return raw / 1e18;
  return raw;
}

function parsePriceUsdFromMarket(m: Record<string, unknown>): number | null {
  const direct = toNum(m.price_usd) ?? toNum(m.token_price);
  if (direct != null && direct > 0) return direct;

  const priceInQuote = toNum(m.price);
  const quoteUsd = toNum(m.quote_price) ?? toNum(m.native_price);
  if (priceInQuote != null && quoteUsd != null && priceInQuote > 0) {
    return priceInQuote * quoteUsd;
  }

  const reserveQuote = toNum(m.reserve_quote);
  const reserveToken = toNum(m.reserve_token);
  if (reserveQuote != null && reserveToken != null && reserveToken > 0 && quoteUsd != null) {
    return (reserveQuote / reserveToken) * quoteUsd;
  }

  return null;
}

function parseMarketCapUsdFromMarket(m: Record<string, unknown>, priceUsd: number | null): number | null {
  const direct = toNum(m.market_cap_usd) ?? toNum(m.market_cap);
  if (direct != null && direct > 0) return direct;

  const supply = parseTokenSupply(m);
  if (priceUsd != null && supply != null) return priceUsd * supply;

  return null;
}

const MAX_SANE_MCAP_USD = 100_000_000_000;

export function parseNadMarketStats(
  market: Record<string, unknown> | null | undefined,
  opts?: { isGraduated?: boolean },
): NadLiveStats {
  const m = market ?? {};
  const priceUsd = parsePriceUsdFromMarket(m);
  const holderCount = toNum(m.holder_count);
  const marketType = typeof m.market_type === "string" ? m.market_type : "";
  const isOnDex = Boolean(opts?.isGraduated) || marketType.includes("DEX");

  let marketCapUsd = parseMarketCapUsdFromMarket(m, priceUsd);

  if (
    marketCapUsd != null &&
    (!Number.isFinite(marketCapUsd) || marketCapUsd < 0 || marketCapUsd > MAX_SANE_MCAP_USD)
  ) {
    marketCapUsd = null;
  }

  return { priceUsd, marketCapUsd, holderCount, marketType, isOnDex };
}

export function formatNadPriceUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1) {
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }
  if (value >= 0.01) {
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  if (value >= 0.0001) {
    return `$${value.toLocaleString(undefined, { maximumSignificantDigits: 4 })}`;
  }
  // Sub-$0.0001 — fixed decimals, never scientific notation.
  const decimals = Math.min(12, Math.max(6, Math.ceil(-Math.log10(value)) + 2));
  const fixed = value.toFixed(decimals).replace(/\.?0+$/, "");
  return `$${fixed}`;
}

export function formatNadMcapUsd(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (value >= 1_000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(0)}`;
}

export function formatNadHolderCount(value: number | null): string {
  if (value == null) return "—";
  return Math.floor(value).toLocaleString();
}

/** Nad API volume is often quote-token base units (18 decimals). */
export function formatNadVolume(raw: string | number | null | undefined): string {
  const n = toNum(raw);
  if (n == null || n <= 0) return "—";

  let value = n;
  if (value >= 1e15) value = value / 1e18;

  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (value >= 1) {
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return `$${value.toLocaleString(undefined, { maximumSignificantDigits: 4 })}`;
}

export const MCAP_PARITY_BAND = 0.1;

export function validateMcapParity(
  stats: (NadLiveStats | null)[],
  symbols: (string | undefined)[],
): string | null {
  const anchor = stats[0]?.marketCapUsd;
  if (anchor == null || anchor <= 0) return null;

  const min = anchor * (1 - MCAP_PARITY_BAND);
  const max = anchor * (1 + MCAP_PARITY_BAND);

  for (let i = 1; i < stats.length; i++) {
    const mcap = stats[i]?.marketCapUsd;
    if (mcap == null) continue;
    const sym = symbols[i] ? `$${symbols[i]}` : `Token ${i + 1}`;
    if (mcap < min || mcap > max) {
      return `${sym} mcap (${formatNadMcapUsd(mcap)}) must be within 10% of the first token (${formatNadMcapUsd(min)}–${formatNadMcapUsd(max)}).`;
    }
  }
  return null;
}

export function maxTokenMcap(stats: (NadLiveStats | null)[]): number | null {
  let max: number | null = null;
  for (const s of stats) {
    const m = s?.marketCapUsd;
    if (m == null || m <= 0) continue;
    max = max == null ? m : Math.max(max, m);
  }
  return max;
}

export function questionRequiresBondingCurve(questionType: string): boolean {
  return questionType === "graduate_by_date" || questionType === "graduate_first";
}

export function validateTokenForQuestion(
  questionType: string,
  symbol: string,
  isGraduated: boolean,
  isOnDex: boolean,
): string | null {
  if (!questionRequiresBondingCurve(questionType)) return null;
  if (isGraduated || isOnDex) {
    if (questionType === "graduate_by_date") {
      return `$${symbol} is already on DEX — this question only works for tokens still on the bonding curve.`;
    }
    return `$${symbol} already graduated — pick tokens still on the bonding curve.`;
  }
  return null;
}

export function formatUsdThresholdValue(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10_000) return String(Math.round(n));
  if (n >= 100) return String(Math.round(n * 100) / 100);
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toPrecision(6);
}

export function defaultUsdThreshold(
  questionType: NadQuestionType,
  stats: NadLiveStats | null | undefined,
): string {
  if (questionType === "price_usd_above" && stats?.priceUsd != null) {
    return formatUsdThresholdValue(stats.priceUsd * 1.1);
  }
  if (questionType === "mcap_usd_above" && stats?.marketCapUsd != null) {
    return formatUsdThresholdValue(Math.max(stats.marketCapUsd, stats.marketCapUsd * 1.1));
  }
  if (questionType === "mcap_threshold_first") {
    const anchor = stats?.marketCapUsd;
    if (anchor != null && anchor > 0) {
      const target = Math.max(anchor * 2, 100_000);
      return formatUsdThresholdValue(Math.ceil(target / 10_000) * 10_000);
    }
    return "1000000";
  }
  return questionType === "price_usd_above" ? "0" : "10000";
}

export function defaultHolderThreshold(stats: NadLiveStats | null | undefined): string {
  if (stats?.holderCount != null) {
    return String(Math.max(1, Math.ceil(stats.holderCount * 1.1)));
  }
  return "500";
}

export function usdThresholdSliderRange(
  questionType: NadQuestionType,
  stats: NadLiveStats | null | undefined,
  allStats?: (NadLiveStats | null)[],
): { min: number; max: number; step: number } | null {
  if (questionType === "mcap_threshold_first") {
    const floor = maxTokenMcap(allStats ?? (stats ? [stats] : []));
    if (floor == null || floor <= 0) return null;
    const min = Math.ceil(floor * 1.05);
    const max = Math.max(min * 10, min + 1_000_000);
    const range = max - min;
    const step = Math.max(1_000, Math.round(range / 200));
    return { min, max, step };
  }

  const floor =
    questionType === "price_usd_above"
      ? stats?.priceUsd
      : questionType === "mcap_usd_above"
        ? stats?.marketCapUsd
        : null;
  if (floor == null || floor <= 0) return null;

  const min = questionType === "mcap_usd_above" ? Math.ceil(floor) : floor;
  const max = min * 10;
  const range = max - min;
  let step: number;
  if (range <= 0) step = min / 100;
  else if (range < 1) step = range / 200;
  else if (range < 1000) step = Math.max(range / 200, 0.01);
  else step = Math.max(1, Math.round(range / 200));

  return { min, max, step };
}

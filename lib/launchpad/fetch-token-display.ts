import type { NadLiveStats } from "@/lib/nad/market-stats";
import { parseNadMarketStats } from "@/lib/nad/market-stats";
import type { NadMarketConfig, NadTokenRef } from "@/lib/nad/types";
import type { PonsOnchainTokenResponse } from "@/lib/pons/types";
import { prismStatsForCardPreview } from "@/lib/prism/adapt-display";
import type { PrismAssetRef, PrismLiveStats } from "@/lib/prism/types";
import { tokenStatsForCardPreview } from "@/lib/token-market/adapt-display";
import type { TokenLiveStats, TokenPairRef } from "@/lib/token-market/types";

export type LaunchpadTokenDisplay = {
  token: NadTokenRef;
  /** Raw Nad-style market_info when available; otherwise null. */
  marketRaw: Record<string, unknown> | null;
  stats: NadLiveStats | null;
  source: "pons" | "nad" | "token-link" | "prism" | null;
};

/** Adapted Pons configs set apiBaseUrl to ponsfamily.com. */
export function isPonsDisplayMarket(nadMarket: NadMarketConfig): boolean {
  return /pons/i.test(nadMarket.apiBaseUrl ?? "");
}

/** Prism RWA markets — no DexScreener pair; use trade chart only. */
export function isPrismDisplayMarket(nadMarket: NadMarketConfig): boolean {
  return /prismassets\.shop|prism/i.test(nadMarket.apiBaseUrl ?? "");
}

export function isTokenLinkUrl(url: string | null | undefined): boolean {
  return /dexscreener\.com|geckoterminal\.com/i.test(url ?? "");
}

/** Token-link (Dex/Gecko) markets adapted into Nad card shape. */
export function isTokenLinkDisplayMarket(nadMarket: NadMarketConfig): boolean {
  if (isTokenLinkUrl(nadMarket.apiBaseUrl)) return true;
  return nadMarket.tokens.some((t) => isTokenLinkUrl(t.sourceUrl));
}

/** Prism asset slug from adapted token (sourceUrl or non-0x address). */
export function prismSlugFromToken(token: NadTokenRef): string | null {
  const fromUrl = token.sourceUrl?.match(/\/assets\/([^/?#]+)/i)?.[1];
  if (fromUrl) return decodeURIComponent(fromUrl);
  if (token.source === "prism" && token.address && !/^0x[a-fA-F0-9]{40}$/.test(token.address)) {
    return token.address;
  }
  return null;
}

function isPrismToken(token: NadTokenRef): boolean {
  if (token.source === "prism") return true;
  return /prismassets\.shop/i.test(token.sourceUrl ?? "");
}

function ponsStatsToLive(stats: PonsOnchainTokenResponse["stats"]): NadLiveStats {
  return {
    priceUsd: stats.priceUsd,
    marketCapUsd: stats.marketCapUsd,
    holderCount: null,
    marketType: stats.isBonded ? "bonding" : "dex",
    isOnDex: !stats.isBonded,
  };
}

async function fetchPrismDisplay(token: NadTokenRef): Promise<LaunchpadTokenDisplay | null> {
  const slug = prismSlugFromToken(token);
  if (!slug) return null;
  try {
    const res = await fetch(`/api/prism/assets/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      asset?: PrismAssetRef;
      stats?: PrismLiveStats;
      error?: string;
    };
    if (!json.asset || !json.stats) return null;
    const merged: NadTokenRef = {
      ...token,
      address: json.asset.address || token.address,
      symbol: json.asset.symbol || token.symbol,
      name: json.asset.name || token.name,
      imageUri: json.asset.imageUri || token.imageUri,
      isGraduated: true,
      sourceUrl: token.sourceUrl,
      source: "prism",
    };
    return {
      token: merged,
      marketRaw: null,
      stats: prismStatsForCardPreview(json.stats),
      source: "prism",
    };
  } catch {
    return null;
  }
}

async function fetchPonsDisplay(token: NadTokenRef): Promise<LaunchpadTokenDisplay | null> {
  try {
    const res = await fetch(`/api/pons/token/${token.address}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as PonsOnchainTokenResponse;
    const merged: NadTokenRef = {
      ...token,
      symbol: json.token?.symbol || token.symbol,
      name: json.token?.name || token.name,
      imageUri: json.token?.imageUri || token.imageUri,
      isGraduated: true,
    };
    return {
      token: merged,
      marketRaw: null,
      stats: ponsStatsToLive(json.stats),
      source: "pons",
    };
  } catch {
    return null;
  }
}

async function fetchNadDisplay(token: NadTokenRef): Promise<LaunchpadTokenDisplay | null> {
  try {
    const res = await fetch(`/api/nad/token/${token.address}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { market_info?: Record<string, unknown> };
    const marketRaw = json.market_info ?? null;
    return {
      token,
      marketRaw,
      stats: parseNadMarketStats(marketRaw, { isGraduated: token.isGraduated }),
      source: "nad",
    };
  } catch {
    return null;
  }
}

async function fetchTokenLinkDisplay(token: NadTokenRef): Promise<LaunchpadTokenDisplay | null> {
  const url = token.sourceUrl?.trim();
  if (!url || !isTokenLinkUrl(url)) return null;
  try {
    const res = await fetch(`/api/token-pair?url=${encodeURIComponent(url)}&display=1`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      pair?: TokenPairRef;
      stats?: TokenLiveStats;
      error?: string;
    };
    if (!json.pair || !json.stats) return null;
    const merged: NadTokenRef = {
      ...token,
      address: json.pair.tokenAddress || token.address,
      symbol: json.pair.symbol || token.symbol,
      name: json.pair.name || token.name,
      imageUri: json.pair.imageUri || token.imageUri,
      isGraduated: true,
      sourceUrl: json.pair.sourceUrl || url,
      source: json.pair.source || token.source,
    };
    const volume = json.stats.volumeUsd24h;
    return {
      token: merged,
      marketRaw:
        volume != null && Number.isFinite(volume)
          ? { volume }
          : null,
      stats: tokenStatsForCardPreview(json.stats),
      source: "token-link",
    };
  } catch {
    return null;
  }
}

/** Prefer Prism catalogue, else pair-page stats, else Pons/Nad launchpad APIs. */
export async function fetchLaunchpadTokenDisplay(
  token: NadTokenRef,
  preferPons: boolean,
): Promise<LaunchpadTokenDisplay> {
  if (isPrismToken(token)) {
    const row = await fetchPrismDisplay(token);
    if (row?.stats) return row;
    return { token, marketRaw: null, stats: null, source: "prism" };
  }

  if (isTokenLinkUrl(token.sourceUrl)) {
    const row = await fetchTokenLinkDisplay(token);
    if (row?.stats) return row;
    return { token, marketRaw: null, stats: null, source: null };
  }

  const order = preferPons || token.isGraduated
    ? [fetchPonsDisplay, fetchNadDisplay]
    : [fetchNadDisplay, fetchPonsDisplay];

  for (const fn of order) {
    const row = await fn(token);
    if (row?.stats) return row;
  }
  return { token, marketRaw: null, stats: null, source: null };
}

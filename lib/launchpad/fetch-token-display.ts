import type { NadLiveStats } from "@/lib/nad/market-stats";
import { parseNadMarketStats } from "@/lib/nad/market-stats";
import type { NadMarketConfig, NadTokenRef } from "@/lib/nad/types";
import type { PonsOnchainTokenResponse } from "@/lib/pons/types";
import { tokenStatsForCardPreview } from "@/lib/token-market/adapt-display";
import type { TokenLiveStats, TokenPairRef } from "@/lib/token-market/types";

export type LaunchpadTokenDisplay = {
  token: NadTokenRef;
  /** Raw Nad-style market_info when available; otherwise null. */
  marketRaw: Record<string, unknown> | null;
  stats: NadLiveStats | null;
  source: "pons" | "nad" | "token-link" | null;
};

/** Adapted Pons configs set apiBaseUrl to ponsfamily.com. */
export function isPonsDisplayMarket(nadMarket: NadMarketConfig): boolean {
  return /pons/i.test(nadMarket.apiBaseUrl ?? "");
}

export function isTokenLinkUrl(url: string | null | undefined): boolean {
  return /dexscreener\.com|geckoterminal\.com/i.test(url ?? "");
}

/** Token-link (Dex/Gecko) markets adapted into Nad card shape. */
export function isTokenLinkDisplayMarket(nadMarket: NadMarketConfig): boolean {
  if (isTokenLinkUrl(nadMarket.apiBaseUrl)) return true;
  return nadMarket.tokens.some((t) => isTokenLinkUrl(t.sourceUrl));
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

/** Prefer pair-page stats for token-link; else Pons/Nad launchpad APIs. */
export async function fetchLaunchpadTokenDisplay(
  token: NadTokenRef,
  preferPons: boolean,
): Promise<LaunchpadTokenDisplay> {
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

import { parseTokenPairLink } from "./parse-link";
import type { TokenLiveStats, TokenPairRef } from "./types";

export class TokenPairNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenPairNotFoundError";
  }
}

export type TokenPairPreview = {
  pair: TokenPairRef;
  stats: TokenLiveStats;
};

export type FetchTokenPairOpts = {
  /** When false, skip the create-time liquidity floor (use for live display). Default true. */
  requireMinLiquidity?: boolean;
};

const MIN_LIQUIDITY_USD = 1_000;

function num(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function assertLiquidity(liq: number | null, requireMin: boolean) {
  if (!requireMin) return;
  if (liq != null && liq < MIN_LIQUIDITY_USD) {
    throw new TokenPairNotFoundError(
      `Pair liquidity is $${liq.toFixed(0)}. Need at least $${MIN_LIQUIDITY_USD}.`,
    );
  }
}

async function fetchDexscreener(
  chainSlug: string,
  pairAddress: string,
  sourceUrl: string,
  opts?: FetchTokenPairOpts,
): Promise<TokenPairPreview> {
  const requireMin = opts?.requireMinLiquidity !== false;
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chainSlug)}/${encodeURIComponent(pairAddress)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new TokenPairNotFoundError("Dexscreener could not find that pair.");
  const json = (await res.json()) as {
    pairs?: Array<{
      chainId?: string;
      pairAddress?: string;
      url?: string;
      baseToken?: { address?: string; symbol?: string; name?: string };
      quoteToken?: { address?: string; symbol?: string };
      priceUsd?: string;
      marketCap?: number;
      fdv?: number;
      liquidity?: { usd?: number };
      volume?: { h24?: number };
      info?: { imageUrl?: string };
    }>;
  };
  const row = json.pairs?.[0];
  const token = row?.baseToken?.address;
  if (!row || !token) throw new TokenPairNotFoundError("Dexscreener returned no base token for that link.");
  const liq = num(row.liquidity?.usd);
  assertLiquidity(liq, requireMin);
  return {
    pair: {
      source: "dexscreener",
      sourceUrl: row.url || sourceUrl,
      chainSlug: (row.chainId || chainSlug).toLowerCase(),
      pairAddress: (row.pairAddress || pairAddress).toLowerCase(),
      tokenAddress: token.toLowerCase(),
      symbol: row.baseToken?.symbol?.trim() || "TOKEN",
      name: row.baseToken?.name?.trim() || row.baseToken?.symbol?.trim() || "Token",
      imageUri: row.info?.imageUrl?.trim() || "",
      quoteSymbol: row.quoteToken?.symbol?.trim() || "QUOTE",
      quoteAddress: (row.quoteToken?.address || "").toLowerCase(),
    },
    stats: {
      priceUsd: num(row.priceUsd),
      marketCapUsd: num(row.marketCap) ?? num(row.fdv),
      liquidityUsd: liq,
      volumeUsd24h: num(row.volume?.h24),
    },
  };
}

async function fetchGecko(
  chainSlug: string,
  pairAddress: string,
  sourceUrl: string,
  opts?: FetchTokenPairOpts,
): Promise<TokenPairPreview> {
  const requireMin = opts?.requireMinLiquidity !== false;
  const res = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(chainSlug)}/pools/${encodeURIComponent(pairAddress)}?include=base_token,quote_token`,
    { cache: "no-store", headers: { accept: "application/json" } },
  );
  if (!res.ok) throw new TokenPairNotFoundError("GeckoTerminal could not find that pool.");
  const json = (await res.json()) as {
    data?: {
      attributes?: {
        address?: string;
        name?: string;
        base_token_price_usd?: string;
        fdv_usd?: string;
        market_cap_usd?: string;
        reserve_in_usd?: string;
        volume_usd?: { h24?: string };
      };
      relationships?: {
        base_token?: { data?: { id?: string } };
        quote_token?: { data?: { id?: string } };
      };
    };
    included?: Array<{
      id?: string;
      attributes?: { address?: string; symbol?: string; name?: string; image_url?: string };
    }>;
  };
  const data = json.data;
  const attrs = data?.attributes;
  if (!data || !attrs) throw new TokenPairNotFoundError("GeckoTerminal returned no pool.");
  const included = json.included ?? [];
  const baseId = data.relationships?.base_token?.data?.id;
  const quoteId = data.relationships?.quote_token?.data?.id;
  const base = included.find((x) => x.id === baseId);
  const quote = included.find((x) => x.id === quoteId);
  const token = base?.attributes?.address;
  if (!token) throw new TokenPairNotFoundError("GeckoTerminal pool is missing a base token. Try include=base_token.");
  const liq = num(attrs.reserve_in_usd);
  assertLiquidity(liq, requireMin);
  return {
    pair: {
      source: "geckoterminal",
      sourceUrl,
      chainSlug,
      pairAddress: (attrs.address || pairAddress).toLowerCase(),
      tokenAddress: token.toLowerCase(),
      symbol: base.attributes?.symbol?.trim() || "TOKEN",
      name: base.attributes?.name?.trim() || base.attributes?.symbol?.trim() || "Token",
      imageUri: base.attributes?.image_url?.trim() || "",
      quoteSymbol: quote?.attributes?.symbol?.trim() || "QUOTE",
      quoteAddress: (quote?.attributes?.address || "").toLowerCase(),
    },
    stats: {
      priceUsd: num(attrs.base_token_price_usd),
      marketCapUsd: num(attrs.market_cap_usd) ?? num(attrs.fdv_usd),
      liquidityUsd: liq,
      volumeUsd24h: num(attrs.volume_usd?.h24),
    },
  };
}

export async function fetchTokenPairFromLink(
  rawUrl: string,
  opts?: FetchTokenPairOpts,
): Promise<TokenPairPreview> {
  const parsed = parseTokenPairLink(rawUrl);
  if (!parsed) {
    throw new TokenPairNotFoundError("Paste a Dexscreener or GeckoTerminal pool link.");
  }
  if (parsed.source === "dexscreener") {
    return fetchDexscreener(parsed.chainSlug, parsed.pairAddress, parsed.sourceUrl, opts);
  }
  return fetchGecko(parsed.chainSlug, parsed.pairAddress, parsed.sourceUrl, opts);
}

export async function fetchTokenPairSnapshot(
  ref: TokenPairRef,
  opts?: FetchTokenPairOpts,
): Promise<TokenPairPreview> {
  if (ref.source === "dexscreener") {
    return fetchDexscreener(ref.chainSlug, ref.pairAddress, ref.sourceUrl, opts);
  }
  return fetchGecko(ref.chainSlug, ref.pairAddress, ref.sourceUrl, opts);
}

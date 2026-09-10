import type { TokenPairSource } from "./types";

export type ParsedTokenPairLink = {
  source: TokenPairSource;
  chainSlug: string;
  pairAddress: string;
  sourceUrl: string;
};

function normalizeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/** Dexscreener: /{chain}/{pair}  GeckoTerminal: /{network}/pools/{pair} */
export function parseTokenPairLink(raw: string): ParsedTokenPairLink | null {
  const url = normalizeUrl(raw);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "dexscreener.com" || host.endsWith(".dexscreener.com")) {
    if (parts.length < 2) return null;
    const chainSlug = parts[0]!.toLowerCase();
    const pairAddress = parts[1]!;
    if (chainSlug === "search" || !pairAddress) return null;
    return {
      source: "dexscreener",
      chainSlug,
      pairAddress,
      sourceUrl: `https://dexscreener.com/${chainSlug}/${pairAddress}`,
    };
  }

  if (host === "geckoterminal.com" || host.endsWith(".geckoterminal.com")) {
    const poolsIdx = parts.findIndex((p) => p === "pools");
    if (poolsIdx <= 0 || !parts[poolsIdx + 1]) return null;
    const chainSlug = parts[poolsIdx - 1]!.toLowerCase();
    const pairAddress = parts[poolsIdx + 1]!;
    return {
      source: "geckoterminal",
      chainSlug,
      pairAddress,
      sourceUrl: `https://www.geckoterminal.com/${chainSlug}/pools/${pairAddress}`,
    };
  }

  return null;
}

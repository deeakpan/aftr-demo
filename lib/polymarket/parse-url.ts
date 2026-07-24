/** Parse a Polymarket event/market URL into a Gamma slug. */

export type ParsedPolymarketUrl = {
  kind: "event" | "market";
  slug: string;
  canonicalUrl: string;
};

function isPolymarketHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === "polymarket.com" || host === "polymarket.eth.link";
}

export function parsePolymarketUrl(input: string): ParsedPolymarketUrl | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  if (!isPolymarketHost(url.hostname)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const kindRaw = parts[0]!.toLowerCase();
  const slug = decodeURIComponent(parts[1]!).trim();
  if (!slug) return null;

  if (kindRaw === "event" || kindRaw === "events") {
    return {
      kind: "event",
      slug,
      canonicalUrl: `https://polymarket.com/event/${encodeURIComponent(slug)}`,
    };
  }
  if (kindRaw === "market" || kindRaw === "markets") {
    return {
      kind: "market",
      slug,
      canonicalUrl: `https://polymarket.com/market/${encodeURIComponent(slug)}`,
    };
  }
  return null;
}

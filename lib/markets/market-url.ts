import { isAddress } from "viem";
import { siteUrl } from "@/lib/site-url";

/** Normalize user/title text into a URL slug. */
export function slugifyMarket(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeMarketSlug(slug: string): string {
  return slugifyMarket(slug);
}

/** Reject slugs that collide with `/market/0x…` address routes. */
export function isReservedMarketSlug(slug: string): boolean {
  const s = slug.trim();
  if (!s) return true;
  if (isAddress(s)) return true;
  if (/^0x[a-f0-9]{40}$/i.test(s)) return true;
  return false;
}

/**
 * In-app navigation path. Always uses the contract address so detail pages
 * load without waiting on slug → address reconstruction.
 */
export function marketPath(opts: { slug?: string | null; address: string }): string {
  return `/market/${opts.address}`;
}

/** Public / share URL — always address-based (no vanity slug in the path). */
export function marketPublicUrl(opts: { slug?: string | null; address: string }): string {
  return `${siteUrl()}/market/${opts.address}`;
}

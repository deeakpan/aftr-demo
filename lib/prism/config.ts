const DEFAULT_PRISM_API = "https://prismassets.shop";

/** Public Prism Assets API origin (CORS-enabled, no key). */
export function prismApiBaseUrl(): string {
  const env =
    process.env.PRISM_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_PRISM_API_BASE_URL?.trim() ||
    "";
  return (env || DEFAULT_PRISM_API).replace(/\/$/, "");
}

export function prismAssetLogoUrl(slug: string): string {
  return `${prismApiBaseUrl()}/logos/${encodeURIComponent(slug)}.png`;
}

export function prismVerifyUrl(query: string): string {
  return `${prismApiBaseUrl()}/verify?q=${encodeURIComponent(query)}`;
}

export function prismListingUrl(slug: string): string {
  return `${prismApiBaseUrl()}/assets/${encodeURIComponent(slug)}`;
}

/** Local brand mark for create UI / cover badge. */
export const PRISM_BRAND_LOGO_PATH = "/prism-logo.svg";

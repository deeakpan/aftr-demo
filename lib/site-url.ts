/** Public app origin — set `NEXT_PUBLIC_SITE_URL` in env (no trailing slash). */
const DEFAULT_SITE_URL = "https://mondolore.fun";

export function siteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return DEFAULT_SITE_URL;
}

/** Host + path prefix shown in create-form slug inputs (e.g. `mondolore.fun/market/`). */
export function marketSlugPrefixLabel(): string {
  try {
    const host = new URL(siteUrl()).host;
    return `${host}/market/`;
  } catch {
    return "mondolore.fun/market/";
  }
}

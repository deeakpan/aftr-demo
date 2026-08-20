/** Published docs — override with NEXT_PUBLIC_DOCS_URL in .env */
const DEFAULT_DOCS_URL = "https://zedkr.finance";

export function docsUrl(path = ""): string {
  const base = (process.env.NEXT_PUBLIC_DOCS_URL?.trim() || DEFAULT_DOCS_URL).replace(/\/$/, "");
  if (!path) return base;
  return `${base}/${path.replace(/^\//, "")}`;
}

import { prismApiBaseUrl, prismAssetLogoUrl } from "./config";
import type { PrismCatalogueAsset, PrismLiveStats } from "./types";

type Envelope<T> = { ok: boolean; data?: T; error?: string };

async function prismGet<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${prismApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Prism API ${res.status} for ${path}`);
  }
  const json = (await res.json()) as Envelope<T> & Record<string, unknown>;
  if (json && typeof json === "object" && "ok" in json && json.ok === false) {
    throw new Error(String(json.error || "Prism API error"));
  }
  if (json && typeof json === "object" && "data" in json) {
    return json.data as T;
  }
  return json as T;
}

export function catalogueAssetToLiveStats(asset: PrismCatalogueAsset): PrismLiveStats {
  return {
    priceUsd: numOrNull(asset.priceUsd),
    marketCapUsd: numOrNull(asset.marketCapUsd),
    yieldApyPct: numOrNull(asset.yieldApyPct),
    change24hPct: numOrNull(asset.change24hPct),
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function primaryDeployment(asset: PrismCatalogueAsset): {
  chain?: string;
  address?: string;
} {
  const deps = asset.deployments ?? [];
  const primary = deps.find((d) => d.isPrimary && d.address) ?? deps.find((d) => d.address);
  return {
    chain: primary?.chain,
    address: primary?.address ?? undefined,
  };
}

export function assetImageUri(asset: { slug: string; logo?: string }): string {
  if (asset.logo?.startsWith("http")) return asset.logo;
  if (asset.logo?.startsWith("/")) return `${prismApiBaseUrl()}${asset.logo}`;
  return prismAssetLogoUrl(asset.slug);
}

export async function fetchPrismAssets(params: {
  q?: string;
  category?: string;
  sort?: string;
  limit?: number;
  cursor?: number | string;
}): Promise<{ items: PrismCatalogueAsset[]; nextCursor?: number | string | null; total?: number }> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.category) sp.set("category", params.category);
  if (params.sort) sp.set("sort", params.sort);
  // Prism catalogue is large (~2k+); page size capped, callers paginate via cursor.
  if (params.limit) sp.set("limit", String(Math.min(100, Math.max(1, params.limit))));
  if (params.cursor != null && params.cursor !== "") sp.set("cursor", String(params.cursor));
  const qs = sp.toString();
  return prismGet(`/api/v1/assets${qs ? `?${qs}` : ""}`);
}

export async function fetchPrismAsset(slug: string): Promise<PrismCatalogueAsset> {
  const data = await prismGet<{ asset?: PrismCatalogueAsset } | PrismCatalogueAsset>(
    `/api/v1/assets/${encodeURIComponent(slug)}`,
  );
  if (data && typeof data === "object" && "asset" in data && data.asset) {
    return data.asset;
  }
  return data as PrismCatalogueAsset;
}

export async function suggestPrismAssets(q: string): Promise<
  Array<{ slug: string; symbol: string; name: string; category: string; chain?: string | null; logo?: string }>
> {
  const url = `${prismApiBaseUrl()}/api/verify/suggest?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Prism suggest ${res.status}`);
  const json = (await res.json()) as { ok?: boolean; results?: Array<Record<string, unknown>> };
  return (json.results ?? []).map((r) => ({
    slug: String(r.slug ?? ""),
    symbol: String(r.symbol ?? ""),
    name: String(r.name ?? ""),
    category: String(r.category ?? ""),
    chain: (r.chain as string | null | undefined) ?? null,
    logo: typeof r.logo === "string" ? r.logo : undefined,
  }));
}

export async function fetchPrismVerifyGrade(q: string): Promise<string | null> {
  try {
    const url = `${prismApiBaseUrl()}/api/verify?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { report?: { grade?: string } };
    return json.report?.grade ?? null;
  } catch {
    return null;
  }
}

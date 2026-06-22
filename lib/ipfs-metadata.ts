import { unstable_cache } from "next/cache";

const IPFS_GATEWAYS = [
  "https://gateway.lighthouse.storage/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
] as const;

const METADATA_FETCH_TIMEOUT_MS = 25_000;

export type IpfsMarketMetadata = {
  title?: string;
  /** Price markets store the generated prompt here as well. */
  question?: string;
  description?: string;
  image?: string;
  outcomes?: string[];
  slug?: string;
  categories?: string[];
  /** Public URLs admins should use when resolving event markets. */
  resolutionSources?: Array<{ label?: string; url: string } | string>;
  nadMarket?: import("@/lib/nad/types").NadMarketConfig;
};

export function ipfsToHttp(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("ipfs://")) {
    return `https://gateway.lighthouse.storage/ipfs/${trimmed.replace("ipfs://", "")}`;
  }
  return trimmed;
}

function resolveMetadataFetchUrls(uri: string): string[] {
  const trimmed = uri.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return [trimmed];
  }
  if (trimmed.startsWith("ipfs://")) {
    const cid = trimmed.slice(7).trim();
    if (!cid) return [];
    return IPFS_GATEWAYS.map((gateway) => `${gateway}${cid}`);
  }
  return [];
}

async function fetchIpfsMetadataUncached(uri: string): Promise<IpfsMarketMetadata | null> {
  const urls = resolveMetadataFetchUrls(uri);
  if (urls.length === 0) return null;

  const lighthouseKey = process.env.LIGHTHOUSE_API_KEY?.trim();
  const headers: Record<string, string> = {};
  if (lighthouseKey) {
    headers.Authorization = `Bearer ${lighthouseKey}`;
  }

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: url.includes("lighthouse.storage") ? headers : undefined,
        signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as IpfsMarketMetadata;
      if (json && typeof json === "object") return json;
    } catch {
      // try next gateway
    }
  }
  return null;
}

/** Fetch market JSON metadata from IPFS or HTTP, trying multiple gateways. Cached 5 min per URI. */
export async function fetchIpfsMetadata(uri: string): Promise<IpfsMarketMetadata | null> {
  const trimmed = uri.trim();
  if (!trimmed) return null;

  const cached = unstable_cache(
    () => fetchIpfsMetadataUncached(trimmed),
    ["ipfs-market-metadata", trimmed],
    { revalidate: 300 },
  );

  return cached();
}

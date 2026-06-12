const IPFS_GATEWAYS = [
  "https://gateway.lighthouse.storage/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/",
] as const;

const METADATA_FETCH_TIMEOUT_MS = 20_000;

export type IpfsMarketMetadata = {
  title?: string;
  description?: string;
  image?: string;
  outcomes?: string[];
  slug?: string;
  categories?: string[];
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

/** Fetch market JSON metadata from IPFS or HTTP, trying multiple gateways. */
export async function fetchIpfsMetadata(uri: string): Promise<IpfsMarketMetadata | null> {
  const urls = resolveMetadataFetchUrls(uri);
  if (urls.length === 0) return null;

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
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

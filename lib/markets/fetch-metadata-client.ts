import { ipfsToHttp, type IpfsMarketMetadata } from "@/lib/ipfs-metadata";

const IPFS_GATEWAYS = [
  "https://gateway.lighthouse.storage/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
] as const;

const TIMEOUT_MS = 20_000;

function resolveUrls(uri: string): string[] {
  const trimmed = uri.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return [trimmed];
  if (trimmed.startsWith("ipfs://")) {
    const cid = trimmed.slice(7).trim();
    if (!cid) return [];
    return IPFS_GATEWAYS.map((g) => `${g}${cid}`);
  }
  return [];
}

/** Browser-safe IPFS metadata fetch (no Next.js server cache). */
export async function fetchIpfsMetadataClient(uri: string): Promise<IpfsMarketMetadata | null> {
  const urls = resolveUrls(uri);
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = (await res.json()) as IpfsMarketMetadata;
      if (json && typeof json === "object") return json;
    } catch {
      // next gateway
    }
  }
  return null;
}

export function metadataTitle(md: IpfsMarketMetadata | null | undefined, kind: "Price" | "Event"): string {
  const title = md?.title?.trim() || md?.question?.trim();
  if (title) return title;
  return kind === "Price" ? "Price market" : "Event market";
}

export function metadataImageUrl(md: IpfsMarketMetadata | null | undefined): string {
  return ipfsToHttp(md?.image?.trim() || "");
}

export function metadataOutcomeLabels(
  md: IpfsMarketMetadata | null | undefined,
  outcomeCount: number,
): string[] {
  const fromIpfs = md?.outcomes?.filter((x): x is string => typeof x === "string") ?? [];
  if (fromIpfs.length > 0) return fromIpfs;
  return Array.from({ length: outcomeCount }, (_, i) => `Outcome ${i + 1}`);
}

export function isWeakMarketMetadata(m: {
  title?: string;
  imageUrl?: string;
}): boolean {
  const title = m.title?.trim() ?? "";
  return (
    !m.imageUrl?.trim() ||
    title === "Price market" ||
    title === "Event market" ||
    title.length === 0
  );
}

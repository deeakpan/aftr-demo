import { ipfsToHttp, type IpfsMarketMetadata } from "@/lib/ipfs-metadata";
import { launchpadMarketForDisplay, launchpadMarketFromMetadata } from "@/lib/launchpad-display";
import type { UiMarketKind } from "@/lib/markets/market-kind";

const PUBLIC_IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
] as const;

const TIMEOUT_MS = 12_000;

function resolveUrls(uri: string): string[] {
  const trimmed = uri.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return [trimmed];
  if (trimmed.startsWith("ipfs://")) {
    const cid = trimmed.slice(7).trim();
    if (!cid) return [];
    const dedicated = (process.env.NEXT_PUBLIC_IPFS_GATEWAY || "").trim();
    const bases = dedicated
      ? [dedicated.replace(/\/?$/, "/").replace(/\/ipfs\/?$/, "/ipfs/"), ...PUBLIC_IPFS_GATEWAYS]
      : [...PUBLIC_IPFS_GATEWAYS];
    return [...new Set(bases.map((g) => `${g.endsWith("/") ? g : `${g}/`}${cid}`))];
  }
  return [];
}

/** Prefer server proxy (dedicated gateway + API key), then public gateways. */
export async function fetchIpfsMetadataClient(uri: string): Promise<IpfsMarketMetadata | null> {
  try {
    const res = await fetch(`/api/ipfs?uri=${encodeURIComponent(uri.trim())}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const json = (await res.json()) as IpfsMarketMetadata;
      if (json && typeof json === "object") return json;
    }
  } catch {
    // fall through to public gateways
  }

  const urls = resolveUrls(uri);
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as IpfsMarketMetadata;
      if (json && typeof json === "object") return json;
    } catch {
      // next gateway
    }
  }
  return null;
}

export function metadataTitle(md: IpfsMarketMetadata | null | undefined, kind: UiMarketKind): string {
  const title = md?.title?.trim() || md?.question?.trim();
  if (title) return title;
  if (kind === "Price") return "Price market";
  if (kind === "Nad" || kind === "Pons" || kind === "Token") return "Token market";
  return "Event market";
}

export function metadataImageUrl(md: IpfsMarketMetadata | null | undefined): string {
  const launchpad = launchpadMarketFromMetadata(md as Record<string, unknown> | null);
  return (
    ipfsToHttp(md?.image?.trim() || "") ||
    launchpad?.tokens?.[0]?.imageUri?.trim() ||
    md?.nadMarket?.tokens?.[0]?.imageUri?.trim() ||
    ""
  );
}

export function metadataLaunchpadMarket(md: IpfsMarketMetadata | null | undefined) {
  return launchpadMarketForDisplay(md as Record<string, unknown> | null);
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

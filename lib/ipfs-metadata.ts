import { unstable_cache } from "next/cache";
import { withRetries } from "./fetch-retry";

const IPFS_GATEWAYS = [
  "https://gateway.lighthouse.storage/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
] as const;

const METADATA_FETCH_TIMEOUT_MS = 6_000;

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
  ponsMarket?: import("@/lib/pons/types").PonsMarketConfig;
  marketKind?: string;
};

export type IpfsFetchAttemptInfo =
  | { phase: "attempt"; attempt: number; maxAttempts: number; uri: string }
  | { phase: "gateway"; attempt: number; url: string }
  | { phase: "retry"; attempt: number; maxAttempts: number; reason: string };

export type IpfsFetchOptions = {
  timeoutMs?: number;
  /** Total attempts across all gateways. Default 3 for no-cache, 1 for cached. */
  attempts?: number;
  delayMs?: number;
  onAttempt?: (info: IpfsFetchAttemptInfo) => void;
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

function lighthouseHeaders(url: string): Record<string, string> | undefined {
  if (!url.includes("lighthouse.storage")) return undefined;
  const lighthouseKey = process.env.LIGHTHOUSE_API_KEY?.trim();
  if (!lighthouseKey) return undefined;
  return { Authorization: `Bearer ${lighthouseKey}` };
}

async function fetchMetadataUrl(url: string, timeoutMs: number): Promise<IpfsMarketMetadata> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: lighthouseHeaders(url),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = (await res.json()) as IpfsMarketMetadata;
  if (!json || typeof json !== "object") {
    throw new Error("invalid JSON");
  }
  return json;
}

/** Race gateways in parallel; first success wins. */
async function fetchIpfsMetadataOnce(
  urls: string[],
  timeoutMs: number,
  onAttempt?: IpfsFetchOptions["onAttempt"],
  attempt = 1,
): Promise<IpfsMarketMetadata> {
  const errors: string[] = [];

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      onAttempt?.({ phase: "gateway", attempt, url });
      return fetchMetadataUrl(url, timeoutMs);
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") return result.value;
    const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
    errors.push(msg);
  }

  throw new Error(errors[0] ?? "all gateways failed");
}

async function fetchIpfsMetadataUncached(uri: string, options: IpfsFetchOptions = {}): Promise<IpfsMarketMetadata | null> {
  const urls = resolveMetadataFetchUrls(uri);
  if (urls.length === 0) return null;

  const timeoutMs = options.timeoutMs ?? METADATA_FETCH_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.attempts ?? 1);

  try {
    return await withRetries(
      async (attempt) => {
        options.onAttempt?.({ phase: "attempt", attempt, maxAttempts, uri });
        return fetchIpfsMetadataOnce(urls, timeoutMs, options.onAttempt, attempt);
      },
      {
        attempts: maxAttempts,
        delayMs: options.delayMs ?? 2000,
        onRetry: ({ attempt, error }) => {
          const reason = error instanceof Error ? error.message : String(error);
          options.onAttempt?.({ phase: "retry", attempt, maxAttempts, reason });
        },
      },
    );
  } catch {
    return null;
  }
}

/** Uncached fetch with retries — for bots/scripts that need fresh metadata at resolve time. */
export async function fetchIpfsMetadataNoCache(
  uri: string,
  options: Omit<IpfsFetchOptions, "attempts"> & { attempts?: number } = {},
): Promise<IpfsMarketMetadata | null> {
  return fetchIpfsMetadataUncached(uri.trim(), {
    attempts: options.attempts ?? 3,
    timeoutMs: options.timeoutMs ?? 10_000,
    delayMs: options.delayMs ?? 2000,
    onAttempt: options.onAttempt,
  });
}

/** Fetch market JSON metadata from IPFS or HTTP, trying multiple gateways. Cached 5 min per URI. */
export async function fetchIpfsMetadata(uri: string): Promise<IpfsMarketMetadata | null> {
  const trimmed = uri.trim();
  if (!trimmed) return null;

  const cached = unstable_cache(
    () => fetchIpfsMetadataUncached(trimmed, { attempts: 2, timeoutMs: METADATA_FETCH_TIMEOUT_MS }),
    ["ipfs-market-metadata", trimmed],
    { revalidate: 300 },
  );

  return cached();
}

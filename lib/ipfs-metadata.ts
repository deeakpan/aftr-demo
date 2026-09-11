import { unstable_cache } from "next/cache";
import { withRetries } from "./fetch-retry";

/** Public gateways — Lighthouse shared gateway is premium-only (HTTP 402) and is omitted. */
const PUBLIC_IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
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
  tokenMarket?: import("@/lib/token-market/types").TokenMarketConfig;
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

/** Dedicated Lighthouse gateway from dashboard profile, e.g. https://xxx.lighthouse.storage/ipfs/ */
function dedicatedGatewayBase(): string | null {
  const raw =
    process.env.LIGHTHOUSE_GATEWAY_URL?.trim() ||
    process.env.IPFS_GATEWAY?.trim() ||
    process.env.NEXT_PUBLIC_IPFS_GATEWAY?.trim() ||
    "";
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/?$/, "/").replace(/\/ipfs\/?$/, "/ipfs/");
}

function gatewayList(): string[] {
  const dedicated = dedicatedGatewayBase();
  const bases = dedicated ? [dedicated, ...PUBLIC_IPFS_GATEWAYS] : [...PUBLIC_IPFS_GATEWAYS];
  return [...new Set(bases.map((b) => (b.endsWith("/") ? b : `${b}/`)))];
}

export function ipfsToHttp(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("ipfs://")) {
    const cid = trimmed.slice(7).trim();
    const base = dedicatedGatewayBase() || "https://ipfs.io/ipfs/";
    return `${base.replace(/\/?$/, "/")}${cid}`;
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
    return gatewayList().map((gateway) => `${gateway}${cid}`);
  }
  return [];
}

function lighthouseHeaders(url: string): Record<string, string> | undefined {
  if (!/lighthouse\.(storage|web3\.xyz)|lighthouseweb3\.xyz/i.test(url)) return undefined;
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

/** Race gateways; first success wins (do not wait for slow failures). */
async function fetchIpfsMetadataOnce(
  urls: string[],
  timeoutMs: number,
  onAttempt?: IpfsFetchOptions["onAttempt"],
  attempt = 1,
): Promise<IpfsMarketMetadata> {
  if (urls.length === 0) throw new Error("no gateways");

  return await new Promise<IpfsMarketMetadata>((resolve, reject) => {
    let pending = urls.length;
    const errors: string[] = [];
    let settled = false;

    for (const url of urls) {
      onAttempt?.({ phase: "gateway", attempt, url });
      void fetchMetadataUrl(url, timeoutMs)
        .then((value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(msg);
          pending -= 1;
          if (!settled && pending === 0) {
            reject(new Error(errors[0] ?? "all gateways failed"));
          }
        });
    }
  });
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
    ["ipfs-market-metadata", trimmed, dedicatedGatewayBase() ?? "public"],
    { revalidate: 300 },
  );

  return cached();
}

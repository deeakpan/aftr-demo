import { knownNadInfraLabel, nadApiBaseUrl } from "./config";
import type { NadTokenMetadataResponse } from "./types";

export class NadTokenNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NadTokenNotFoundError";
  }
}

function formatNadApiError(body: string, status: number, tokenAddress: string): string {
  const infra = knownNadInfraLabel(tokenAddress);
  if (infra) {
    return `${infra} is not a Nad.fun meme token. Copy a token CA from testnet.nad.fun.`;
  }

  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error === "Invalid token id") {
      return "Not a Nad.fun token. Paste a meme token contract from testnet.nad.fun (not WMON, router, or curve).";
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // not JSON
  }

  return body.trim() || `Nad API HTTP ${status}`;
}

export async function fetchNadTokenMetadata(tokenAddress: string): Promise<NadTokenMetadataResponse> {
  const infra = knownNadInfraLabel(tokenAddress);
  if (infra) {
    throw new NadTokenNotFoundError(
      `${infra} is not a Nad.fun meme token. Copy a token CA from testnet.nad.fun.`,
    );
  }

  const base = nadApiBaseUrl();
  const url = `${base}/token/metadata/${tokenAddress.toLowerCase()}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const message = formatNadApiError(body, res.status, tokenAddress);
    if (res.status === 400 || res.status === 404) {
      throw new NadTokenNotFoundError(message);
    }
    throw new Error(message);
  }
  return (await res.json()) as NadTokenMetadataResponse;
}

export type NadChartResponse = {
  k: string;
  t: number[];
  c: string[];
  o: string[];
  h: string[];
  l: string[];
  v: string[];
  s: string;
};

export async function fetchNadChart(
  tokenAddress: string,
  opts?: { resolution?: string; countback?: number; chartType?: string },
): Promise<NadChartResponse> {
  const base = nadApiBaseUrl();
  const to = Math.floor(Date.now() / 1000);
  const from = to - 7 * 24 * 3600;
  const params = new URLSearchParams({
    from: String(from),
    to: String(to),
    countback: String(opts?.countback ?? 120),
    resolution: opts?.resolution ?? "60",
    chart_type: opts?.chartType ?? "price_usd",
  });
  const url = `${base}/trade/chart/${tokenAddress.toLowerCase()}?${params}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`Nad chart HTTP ${res.status}`);
  return (await res.json()) as NadChartResponse;
}

export async function fetchNadMarket(tokenAddress: string) {
  const base = nadApiBaseUrl();
  const url = `${base}/trade/market/${tokenAddress.toLowerCase()}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`Nad market HTTP ${res.status}`);
  return (await res.json()) as { market_info: NadTokenMetadataResponse["market_info"] };
}

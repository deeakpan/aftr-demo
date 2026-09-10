import { http, type HttpTransport } from "viem";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CLOUDFLARE_HINT =
  "Robinhood public RPC is behind a Cloudflare challenge. Set NEXT_PUBLIC_RPC_URL or RPC_URL to an Alchemy or QuickNode endpoint (https://robinhood-mainnet.g.alchemy.com/v2/YOUR_KEY).";

function looksLikeCloudflare(status: number, body: string, contentType: string) {
  return (
    contentType.includes("text/html") ||
    /just a moment|cdn-cgi\/challenge|__cf_chl|Enable JavaScript and cookies/i.test(body) ||
    (status === 403 && /<!DOCTYPE html|cloudflare/i.test(body))
  );
}

/** Node/undici often gets Cloudflare HTML instead of JSON from the public Robinhood RPC. */
export async function rpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", BROWSER_UA);
  if (!headers.has("accept")) headers.set("accept", "application/json");

  const response = await fetch(input, { ...init, headers, cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";
  if (response.ok && contentType.includes("application/json")) {
    return response;
  }

  const body = await response.clone().text().catch(() => "");
  if (looksLikeCloudflare(response.status, body, contentType)) {
    throw new Error(CLOUDFLARE_HINT);
  }
  return response;
}

export function deploymentHttpTransport(url: string): HttpTransport {
  return http(url, {
    timeout: 25_000,
    retryCount: 2,
    retryDelay: 600,
    fetchFn: rpcFetch,
    fetchOptions: {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "user-agent": BROWSER_UA,
      },
    },
  });
}

export function isCloudflareRpcError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /cloudflare|just a moment|__cf_chl|Status:\s*403/i.test(msg);
}

export { CLOUDFLARE_HINT };

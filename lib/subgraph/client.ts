import { withRetries } from "@/lib/fetch-retry";

const DEFAULT_SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/1749057/zedkr-testnet/v0.07";

const SUBGRAPH_TIMEOUT_MS = 30_000;

/** Read at request time so `.env` changes apply without a stale module binding. */
export function getSubgraphUrl(): string {
  const fromEnv = process.env.SUBGRAPH_QUERY_URL?.trim();
  return fromEnv || DEFAULT_SUBGRAPH_URL;
}

export type SubgraphQueryResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

async function querySubgraphOnce<TData>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<SubgraphQueryResult<TData>> {
  const url = getSubgraphUrl();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: AbortSignal.timeout(SUBGRAPH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { ok: false, reason: `Subgraph HTTP ${res.status}` };
    }

    const json = (await res.json()) as { data?: TData; errors?: { message?: string }[] };
    if (json.errors?.length) {
      const detail = json.errors[0]?.message ?? "unknown";
      return { ok: false, reason: `Subgraph GraphQL error: ${detail}` };
    }

    if (!json.data) {
      return { ok: false, reason: "Subgraph returned no data" };
    }

    return { ok: true, data: json.data };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "Subgraph request timed out"
        : err instanceof Error
          ? err.message
          : "Subgraph fetch failed";
    return { ok: false, reason };
  }
}

/** POST a GraphQL query with retries; never throws (DNS/offline/timeouts return ok: false). */
export async function querySubgraph<TData>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<SubgraphQueryResult<TData>> {
  try {
    return await withRetries(
      async () => {
        const result = await querySubgraphOnce<TData>(query, variables);
        if (!result.ok) {
          throw new Error(result.reason);
        }
        return result;
      },
      { attempts: 3, delayMs: 400 },
    );
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Subgraph fetch failed",
    };
  }
}

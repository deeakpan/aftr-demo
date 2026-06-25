/* eslint-disable no-console */
/**
 * Query subgraph for PRICE/NAD markets due for settlement (no full factory scan).
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const DEFAULT_SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/1749057/mondalore-testnet/v0.07";

const SETTLEMENT_CANDIDATES_QUERY = `
  query SettlementCandidates($now: BigInt!, $first: Int!) {
    markets(
      where: {
        resolveAfterTimestamp_lte: $now
        kind_in: [0, 2]
        state: 0
      }
      first: $first
      orderBy: resolveAfterTimestamp
      orderDirection: asc
    ) {
      id
      kind
      metadataURI
      resolveAfterTimestamp
    }
  }
`;

/** Older subgraphs without state/metadataURI fields. */
const SETTLEMENT_CANDIDATES_LEGACY_QUERY = `
  query SettlementCandidatesLegacy($now: BigInt!, $first: Int!) {
    markets(
      where: {
        resolveAfterTimestamp_lte: $now
        kind_in: [0, 2]
      }
      first: $first
      orderBy: resolveAfterTimestamp
      orderDirection: asc
    ) {
      id
      kind
      resolveAfterTimestamp
    }
  }
`;

function getSubgraphUrl() {
  return (process.env.SUBGRAPH_QUERY_URL || "").trim() || DEFAULT_SUBGRAPH_URL;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postGraphql(query, variables, { attempts = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(getSubgraphUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        throw new Error(`Subgraph HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(json.errors[0]?.message || "Subgraph GraphQL error");
      }
      return json.data;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const waitMs = 2000 * attempt;
        console.warn(`  subgraph retry ${attempt}/${attempts} in ${waitMs}ms…`);
        await sleep(waitMs);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * @returns {Promise<{ rows: { address: string, kind: number, metadataURI?: string, resolveAfter: number }[], source: string }>}
 */
async function fetchSettlementCandidates(nowSec, { first = 500 } = {}) {
  const now = String(nowSec);

  try {
    const data = await postGraphql(SETTLEMENT_CANDIDATES_QUERY, { now, first });
    const markets = data?.markets ?? [];
    return {
      source: "subgraph",
      rows: markets.map((m) => ({
        address: m.id,
        kind: Number(m.kind),
        metadataURI: m.metadataURI || undefined,
        resolveAfter: Number(m.resolveAfterTimestamp),
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/state|metadataURI|field/i.test(msg)) {
      throw err;
    }
    console.warn("  subgraph: falling back to legacy query (redeploy subgraph for state filter)");
    const data = await postGraphql(SETTLEMENT_CANDIDATES_LEGACY_QUERY, { now, first });
    const markets = data?.markets ?? [];
    return {
      source: "subgraph-legacy",
      rows: markets.map((m) => ({
        address: m.id,
        kind: Number(m.kind),
        resolveAfter: Number(m.resolveAfterTimestamp),
      })),
    };
  }
}

module.exports = { fetchSettlementCandidates, getSubgraphUrl };

import { getAddress } from "viem";
import { fetchDueFromFactories, hydrateMarket } from "./factory";
import { fetchDueFromSubgraph } from "./subgraph";
import { KIND_EVENT, KIND_PONS, KIND_PRICE, STATE_OPEN, type DueMarket } from "./types";

function mergeDue(a: DueMarket[], b: DueMarket[]): DueMarket[] {
  const byAddr = new Map<string, DueMarket>();
  for (const row of [...a, ...b]) {
    const key = row.address.toLowerCase();
    const prev = byAddr.get(key);
    if (!prev) {
      byAddr.set(key, { ...row, sources: [...row.sources] });
      continue;
    }
    const sources = [...new Set([...prev.sources, ...row.sources])];
    byAddr.set(key, {
      address: prev.address,
      kind: prev.kind || row.kind,
      state: prev.state,
      resolveAfter: prev.resolveAfter || row.resolveAfter,
      metadataURI: prev.metadataURI || row.metadataURI,
      sources,
    });
  }
  return [...byAddr.values()].sort((x, y) => x.resolveAfter - y.resolveAfter);
}

export async function collectDueMarkets(nowSec = Math.floor(Date.now() / 1000)): Promise<{
  due: DueMarket[];
  subgraphOk: boolean;
  subgraphError?: string;
  factoryOk: boolean;
  factoryError?: string;
}> {
  const [subgraph, factory] = await Promise.allSettled([
    fetchDueFromSubgraph(nowSec),
    fetchDueFromFactories(nowSec),
  ]);

  let subgraphMarkets: DueMarket[] = [];
  let subgraphOk = false;
  let subgraphError: string | undefined;
  if (subgraph.status === "fulfilled") {
    subgraphOk = subgraph.value.ok;
    subgraphMarkets = subgraph.value.markets;
    if (!subgraph.value.ok) subgraphError = subgraph.value.reason;
  } else {
    subgraphError = subgraph.reason instanceof Error ? subgraph.reason.message : String(subgraph.reason);
  }

  let factoryMarkets: DueMarket[] = [];
  let factoryOk = false;
  let factoryError: string | undefined;
  if (factory.status === "fulfilled") {
    factoryOk = true;
    factoryMarkets = factory.value;
  } else {
    factoryError = factory.reason instanceof Error ? factory.reason.message : String(factory.reason);
  }

  const merged = mergeDue(subgraphMarkets, factoryMarkets);
  const verified: DueMarket[] = [];
  for (const row of merged) {
    try {
      const live = await hydrateMarket(row.address);
      if (live.state !== STATE_OPEN) continue;
      if (nowSec < live.resolveAfter) continue;
      if (live.kind !== KIND_PRICE && live.kind !== KIND_EVENT && live.kind !== KIND_PONS) continue;
      verified.push({
        address: getAddress(row.address),
        kind: live.kind,
        state: live.state,
        resolveAfter: live.resolveAfter,
        metadataURI: live.metadataURI || row.metadataURI,
        sources: row.sources,
      });
    } catch {
      // Skip markets that fail on-chain reads (wrong ABI / vanished).
    }
  }

  return { due: verified, subgraphOk, subgraphError, factoryOk, factoryError };
}

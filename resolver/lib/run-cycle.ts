import { collectDueMarkets } from "./candidates";
import { resolverAccount } from "./clients";
import { settleDueMarket } from "./settle";
import { getSubgraphUrl } from "./subgraph";
import type { CycleResult } from "./types";

let lastCycle: CycleResult | null = null;
let inFlight: Promise<CycleResult> | null = null;

export function getLastCycle(): CycleResult | null {
  return lastCycle;
}

export async function runCycle(opts: { dryRun?: boolean } = {}): Promise<CycleResult> {
  if (inFlight) return inFlight;
  inFlight = runCycleUnqueued(opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runCycleUnqueued(opts: { dryRun?: boolean } = {}): Promise<CycleResult> {
  const dryRun = Boolean(opts.dryRun);
  const startedAt = new Date().toISOString();
  const account = resolverAccount();
  const found = await collectDueMarkets();
  const actions = [];
  for (const market of found.due) {
    const result = await settleDueMarket(market, dryRun);
    actions.push(result);
    const tag = result.error ? "fail" : result.skipped ? "skip" : "ok";
    console.log(
      `[resolver] ${tag} ${market.address} kind=${market.kind} ${result.action}` +
        (result.txHash ? ` tx=${result.txHash}` : "") +
        (result.error ? ` err=${result.error}` : ""),
    );
  }

  const cycle: CycleResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun,
    subgraphUrl: getSubgraphUrl(),
    subgraphOk: found.subgraphOk,
    subgraphError: found.subgraphError,
    factoryOk: found.factoryOk,
    factoryError: found.factoryError,
    due: found.due,
    actions,
    resolver: account?.address ?? null,
  };
  lastCycle = cycle;
  return cycle;
}

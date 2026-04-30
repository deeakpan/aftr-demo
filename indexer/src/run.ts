import type { Address } from "viem";
import type { IndexerConfig } from "./config.js";
import { loadConfig } from "./config.js";
import {
  createChainClient,
  fetchFactoryMarkets,
  fetchLogsForMarketBatch,
  type MarketIndexedLog,
} from "./chain.js";
import { createIndexerSupabase } from "./supabase-client.js";

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toBig(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  return BigInt(String(value));
}

function bigintToDecimalString(value: bigint): string {
  return value.toString(10);
}

function batches<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("batch size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size) as T[]);
  }
  return out;
}

function spansInclusive(fromBlock: bigint, toBlockInclusive: bigint, chunk: bigint): [bigint, bigint][] {
  if (chunk < 1n) throw new Error("BLOCK_CHUNK must be >= 1");
  const out: [bigint, bigint][] = [];
  let cur = fromBlock;
  while (cur <= toBlockInclusive) {
    const spanEnd =
      cur + chunk - 1n <= toBlockInclusive ? cur + chunk - 1n : toBlockInclusive;
    out.push([cur, spanEnd]);
    cur = spanEnd + 1n;
  }
  return out;
}

async function ensureCheckpoint(cfg: IndexerConfig, cursorSeed: bigint) {
  const supabase = createIndexerSupabase(cfg);
  const { data, error } = await supabase
    .from("indexer_checkpoint")
    .select("last_finalized_block")
    .eq("id", "singleton")
    .maybeSingle();

  if (error) throw error;

  if (data === null) {
    const { error: insErr } = await supabase.from("indexer_checkpoint").insert({
      id: "singleton",
      chain_id: bigintToDecimalString(cfg.chainId),
      last_finalized_block: bigintToDecimalString(cursorSeed),
    });
    if (insErr) throw insErr;
    return cursorSeed;
  }

  return toBig(data.last_finalized_block);
}

async function persistCheckpoint(cfg: IndexerConfig, inclusiveBlock: bigint) {
  const supabase = createIndexerSupabase(cfg);
  const { error } = await supabase
    .from("indexer_checkpoint")
    .upsert(
      {
        id: "singleton",
        chain_id: bigintToDecimalString(cfg.chainId),
        last_finalized_block: bigintToDecimalString(inclusiveBlock),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (error) throw error;
}

async function registerMarkets(
  cfg: IndexerConfig,
  markets: readonly Address[],
) {
  if (markets.length === 0) return;
  const supabase = createIndexerSupabase(cfg);
  const { error } = await supabase.from("indexer_markets_registry").upsert(
    markets.map((a) => ({
      chain_id: bigintToDecimalString(cfg.chainId),
      address: a.toLowerCase(),
    })),
    { onConflict: "chain_id,address" },
  );
  if (error) throw error;
}

async function ingestOneLog(
  cfg: IndexerConfig,
  supabase: ReturnType<typeof createIndexerSupabase>,
  log: MarketIndexedLog,
) {
  if (!log.blockNumber || !log.transactionHash) return;
  if (typeof log.logIndex !== "number") return;

  const chainIdPg = bigintToDecimalString(cfg.chainId);
  const market = log.address.toLowerCase();
  const txHash = log.transactionHash;
  const logIndex = log.logIndex;
  const blockNumber = log.blockNumber;

  if (!("eventName" in log) || !log.args) return;

  if (log.eventName === "Deposited") {
    const a = log.args as {
      buyer: Address;
      recipient: Address;
      outcomeIndex: number;
      collateralAmount: bigint;
      sharesMinted: bigint;
      price1e18: bigint;
    };
    const { error } = await supabase.rpc("indexer_ingest_deposited", {
      p_chain_id: chainIdPg,
      p_tx_hash: txHash,
      p_log_index: logIndex,
      p_block_number: bigintToDecimalString(blockNumber),
      p_market: market,
      p_buyer: a.buyer,
      p_recipient: a.recipient,
      p_outcome_index: Number(a.outcomeIndex),
      p_collateral_amount: bigintToDecimalString(a.collateralAmount),
      p_shares_minted: bigintToDecimalString(a.sharesMinted),
      p_price1e18: bigintToDecimalString(a.price1e18),
    });
    if (error) throw error;
    return;
  }

  if (log.eventName === "TokensRedeemed") {
    const a = log.args as {
      user: Address;
      outcomeIndex: number;
      shares: bigint;
      payout: bigint;
    };
    const { error } = await supabase.rpc("indexer_ingest_redeemed", {
      p_chain_id: chainIdPg,
      p_tx_hash: txHash,
      p_log_index: logIndex,
      p_block_number: bigintToDecimalString(blockNumber),
      p_market: market,
      p_user: a.user,
      p_outcome_index: Number(a.outcomeIndex),
      p_shares: bigintToDecimalString(a.shares),
      p_payout: bigintToDecimalString(a.payout),
    });
    if (error) throw error;
  }
}

export async function runTick(cfg: IndexerConfig) {
  const client = createChainClient(cfg);
  const supabase = createIndexerSupabase(cfg);

  const initialCursor =
    cfg.scanFromBlock > 0n ? cfg.scanFromBlock - 1n : (-1n as bigint);

  let cursorInclusive = await ensureCheckpoint(cfg, initialCursor);

  const markets = await fetchFactoryMarkets(client, cfg.factoryAddress);
  await registerMarkets(cfg, markets);

  const latest = await client.getBlockNumber();
  const confirmations = cfg.confirmations;
  const overlap = cfg.overlapBlocks;

  let safeInclusive = latest - confirmations;
  if (safeInclusive < 0n) safeInclusive = 0n;

  const fromExclusiveNext = cursorInclusive + 1n - overlap;
  let fromInclusive = cfg.scanFromBlock > fromExclusiveNext ? cfg.scanFromBlock : fromExclusiveNext;
  if (fromInclusive < 0n) fromInclusive = 0n;

  if (fromInclusive > safeInclusive) {
    return {
      scanned: false,
      markets: markets.length,
      fromInclusive,
      safeInclusive,
    };
  }

  const ranges = spansInclusive(fromInclusive, safeInclusive, cfg.blockChunk);

  for (const [lo, hi] of ranges) {
    const chunks = batches(markets, cfg.addressBatch);
    const logTasks: Promise<MarketIndexedLog[]>[] = [];
    // eslint-disable-next-line no-restricted-syntax -- deterministic batch order
    for (const addrChunk of chunks) {
      if (addrChunk.length === 0) continue;
      logTasks.push(fetchLogsForMarketBatch(client, addrChunk, lo, hi));
    }
    const logGroups = await Promise.all(logTasks);
    const merged = logGroups.flat();
    merged.sort((a, b) => {
      const bn = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n);
      if (bn < 0n) return -1;
      if (bn > 0n) return 1;
      const tn = Number(a.transactionIndex ?? 0) - Number(b.transactionIndex ?? 0);
      if (tn !== 0) return tn;
      return (a.logIndex ?? 0) - (b.logIndex ?? 0);
    });

    // eslint-disable-next-line no-restricted-syntax -- must process in deterministic order per block
    for (const lg of merged) {
      await ingestOneLog(cfg, supabase, lg);
    }

    await persistCheckpoint(cfg, hi);
  }

  return {
    scanned: true,
    markets: markets.length,
    fromInclusive,
    safeInclusive,
    blocksSeen: `${fromInclusive}->${safeInclusive}`,
  };
}

async function main() {
  const cfg = loadConfig();
  console.log("[indexer] tick", {
    chainId: cfg.chainId.toString(),
    factory: cfg.factoryAddress,
    pollMs: cfg.pollIntervalMs,
  });

  // eslint-disable-next-line no-constant-condition -- intentional daemon loop
  while (true) {
    try {
      const r = await runTick(cfg);
      console.log("[indexer] ok", r);
    } catch (e) {
      console.error("[indexer] tick failed:", e instanceof Error ? e.message : e);
    }
    await sleep(Number.isFinite(cfg.pollIntervalMs) ? cfg.pollIntervalMs : 15_000);
  }
}

void main();

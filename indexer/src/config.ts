import "dotenv/config";

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() ?? fallback;
}

export type IndexerConfig = {
  chainId: bigint;
  rpcUrl: string;
  factoryAddress: `0x${string}`;
  /** First block cursor should consider worth scanning down to (cold start alignment). */
  scanFromBlock: bigint;
  confirmations: bigint;
  overlapBlocks: bigint;
  blockChunk: bigint;
  addressBatch: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  pollIntervalMs: number;
};

export function loadConfig(): IndexerConfig {
  const chainId = BigInt(req("CHAIN_ID"));
  const scanFromBlock = BigInt(optional("SCAN_FROM_BLOCK", "0"));

  const addressBatchRaw = Number(optional("ADDRESS_BATCH", "80"));
  const addressBatch = Number.isFinite(addressBatchRaw)
    ? Math.max(5, Math.min(500, addressBatchRaw))
    : 80;

  return {
    chainId,
    rpcUrl: req("RPC_URL"),
    factoryAddress: req("FACTORY_ADDRESS") as `0x${string}`,
    scanFromBlock,
    confirmations: BigInt(optional("CONFIRMATIONS", "12")),
    overlapBlocks: BigInt(optional("OVERLAP_BLOCKS", "48")),
    blockChunk: BigInt(optional("BLOCK_CHUNK", "3500")),
    addressBatch,
    supabaseUrl: req("SUPABASE_URL"),
    supabaseServiceRoleKey: req("SUPABASE_SERVICE_ROLE_KEY"),
    pollIntervalMs: Number(optional("POLL_INTERVAL_MS", "15000")),
  };
}

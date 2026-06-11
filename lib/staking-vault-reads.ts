import type { PublicClient } from "viem";
import type { Address } from "viem";
import { ERC20_ABI, STAKE_TOKEN_ADDRESS, VAULT_ABI, VAULT_ADDRESS } from "@/lib/staking";

export type VaultMeta = {
  receiptToken: Address;
  stakeDecimals: number;
  lockDuration: number;
};

export type VaultSnapshot = {
  totalStaked: bigint;
  currentEpoch: bigint;
  walletBalance: bigint;
  stakedReceipt: bigint;
  earnedTokens: Address[];
  earnedAmounts: bigint[];
  withdrawable: bigint;
  locked: bigint;
  nextUnlockAt: bigint;
};

let cachedMeta: VaultMeta | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /15\/sec|rate limit|too many/i.test(msg);
}

async function loadVaultMeta(client: PublicClient): Promise<VaultMeta> {
  if (cachedMeta) return cachedMeta;
  if (!VAULT_ADDRESS || !STAKE_TOKEN_ADDRESS) {
    throw new Error("Vault or stake token not configured.");
  }

  const rows = await client.multicall({
    contracts: [
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "receiptToken" },
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "lockDuration" },
      { address: STAKE_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "decimals" },
    ],
  });

  cachedMeta = {
    receiptToken: rows[0]!.result as Address,
    lockDuration: Number(rows[1]!.result as bigint),
    stakeDecimals: Number(rows[2]!.result as number),
  };
  return cachedMeta;
}

/** Batched vault reads — one multicall round for globals, one for wallet (when connected). */
export async function readVaultSnapshot(
  client: PublicClient,
  wallet?: Address,
): Promise<{ meta: VaultMeta; snapshot: VaultSnapshot }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await readVaultSnapshotOnce(client, wallet);
    } catch (err) {
      if (!isRateLimitError(err) || attempt === 2) throw err;
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error("Could not load vault snapshot.");
}

async function readVaultSnapshotOnce(
  client: PublicClient,
  wallet?: Address,
): Promise<{ meta: VaultMeta; snapshot: VaultSnapshot }> {
  if (!VAULT_ADDRESS || !STAKE_TOKEN_ADDRESS) {
    throw new Error("Vault or stake token not configured.");
  }

  const meta = await loadVaultMeta(client);

  const globalRows = await client.multicall({
    contracts: [
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "totalStaked" },
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "currentEpoch" },
    ],
  });

  let walletBalance = BigInt(0);
  let stakedReceipt = BigInt(0);
  let earnedTokens: Address[] = [];
  let earnedAmounts: bigint[] = [];
  let withdrawable = BigInt(0);
  let locked = BigInt(0);
  let nextUnlockAt = BigInt(0);

  if (wallet) {
    const userRows = await client.multicall({
      contracts: [
        {
          address: STAKE_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [wallet],
        },
        {
          address: meta.receiptToken,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [wallet],
        },
        {
          address: VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: "earnedAll",
          args: [wallet],
        },
        {
          address: VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: "withdrawStatus",
          args: [wallet],
        },
      ],
    });

    walletBalance = userRows[0]!.result as bigint;
    stakedReceipt = userRows[1]!.result as bigint;
    const earned = userRows[2]!.result as [Address[], bigint[]];
    earnedTokens = earned[0] ?? [];
    earnedAmounts = earned[1] ?? [];
    const status = userRows[3]!.result as [bigint, bigint, bigint];
    withdrawable = status[0] ?? BigInt(0);
    locked = status[1] ?? BigInt(0);
    nextUnlockAt = status[2] ?? BigInt(0);
  }

  return {
    meta,
    snapshot: {
      totalStaked: globalRows[0]!.result as bigint,
      currentEpoch: globalRows[1]!.result as bigint,
      walletBalance,
      stakedReceipt,
      earnedTokens,
      earnedAmounts,
      withdrawable,
      locked,
      nextUnlockAt,
    },
  };
}

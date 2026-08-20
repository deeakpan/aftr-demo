import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Hex,
  type PublicClient,
  type TransactionSerializable,
} from "viem";
import { privateKeyToAccount, toAccount } from "viem/accounts";
import { DEPLOYMENT_CHAIN, DEPLOYMENT_CHAIN_ID, deploymentRpcUrl } from "@/lib/chain";
import { paraRest } from "@/lib/para-rest";
import { getParaWalletByOwner } from "@/lib/para-wallets-store";
import { formatUserTxError } from "@/lib/tx-error";

function rpcUrl() {
  return process.env.MARKET_RPC_URL?.trim() || deploymentRpcUrl();
}

function gasKey(): `0x${string}` | null {
  const raw = (process.env.MARKET_GAS_PRIVATE_KEY || process.env.PRIVATE_KEY || "").trim();
  if (!raw) return null;
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

async function maybeTopUpGas(owner: `0x${string}`) {
  const key = gasKey();
  if (!key) return;
  const publicClient = createPublicClient({ chain: DEPLOYMENT_CHAIN, transport: http(rpcUrl()) });
  const bal = await publicClient.getBalance({ address: owner });
  const min = BigInt(process.env.MARKET_GAS_MIN_WEI ?? "10000000000000000"); // 0.01 MON
  if (bal >= min) return;
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({
    account,
    chain: DEPLOYMENT_CHAIN,
    transport: http(rpcUrl()),
  });
  const amount = BigInt(process.env.MARKET_GAS_TOPUP_WEI ?? "20000000000000000"); // 0.02 MON
  const hash = await wallet.sendTransaction({ to: owner, value: amount });
  await publicClient.waitForTransactionReceipt({ hash });
}

const MAX_GAS_TOPUP = parseEther("5");
const FUNDER_GAS_RESERVE = parseEther("0.02");

/** Monad nodes reject type-2 txs unless balance covers gasLimit * maxFeePerGas. */
async function ensureNativeForTx(
  owner: `0x${string}`,
  publicClient: PublicClient,
  needed: bigint,
) {
  const bal = await publicClient.getBalance({ address: owner });
  if (bal >= needed) return;

  const key = gasKey();
  const shortfall = needed - bal;
  if (!key) {
    throw new Error(
      `Not enough MON for gas. Need ~${formatEther(needed)} MON reserved, wallet has ${formatEther(bal)} MON.`,
    );
  }
  const funder = privateKeyToAccount(key);
  const funderBal = await publicClient.getBalance({ address: funder.address });
  const maxSend =
    funderBal > FUNDER_GAS_RESERVE ? funderBal - FUNDER_GAS_RESERVE : BigInt(0);
  let topup = shortfall + parseEther("0.05");
  if (topup > MAX_GAS_TOPUP) topup = MAX_GAS_TOPUP;
  if (topup > maxSend) topup = maxSend;
  if (topup <= BigInt(0)) {
    throw new Error(
      `Not enough MON for gas. Need ~${formatEther(needed)} MON reserved, wallet has ${formatEther(bal)} MON.`,
    );
  }
  const wallet = createWalletClient({
    account: funder,
    chain: DEPLOYMENT_CHAIN,
    transport: http(rpcUrl()),
  });
  const hash = await wallet.sendTransaction({ to: owner, value: topup });
  await publicClient.waitForTransactionReceipt({ hash });
  const after = await publicClient.getBalance({ address: owner });
  if (after < needed) {
    throw new Error(
      `Not enough MON for gas. Need ~${formatEther(needed)} MON reserved, wallet has ${formatEther(after)} MON.`,
    );
  }
}

type SignTxResponse = {
  signature?: string;
  signedTransaction?: string;
  signed_transaction?: string;
  data?: { signature?: string; signedTransaction?: string };
};

async function withRpcRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 400));
    return fn();
  }
}

async function paraRestSignTransaction(walletId: string, tx: TransactionSerializable) {
  return paraRest<SignTxResponse>(`/v1/wallets/${walletId}/sign-transaction`, {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({
      broadcast: false,
      transaction: {
        to: tx.to,
        chainId: tx.chainId ?? DEPLOYMENT_CHAIN_ID,
        type: tx.maxFeePerGas != null ? 2 : 0,
        value: (tx.value ?? BigInt(0)).toString(),
        data: tx.data ?? "0x",
        nonce: tx.nonce,
        gasLimit: tx.gas?.toString(),
        ...(tx.maxFeePerGas != null
          ? {
              maxFeePerGas: tx.maxFeePerGas.toString(),
              maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
            }
          : { gasPrice: tx.gasPrice?.toString() }),
      },
    }),
  });
}

function pickSignedTx(res: SignTxResponse): Hex {
  const raw =
    res.signedTransaction ||
    res.signed_transaction ||
    res.signature ||
    res.data?.signedTransaction ||
    res.data?.signature;
  if (!raw || typeof raw !== "string") {
    throw new Error("Para did not return a signed transaction.");
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

export async function sendViaPara(owner: `0x${string}`, tx: { to: `0x${string}`; data?: Hex; value?: bigint }) {
  const mapping = await getParaWalletByOwner(owner);
  if (!mapping) throw new Error(`No Para REST wallet for ${owner}`);

  const publicClient = createPublicClient({ chain: DEPLOYMENT_CHAIN, transport: http(rpcUrl()) });
  const nonce = await publicClient.getTransactionCount({ address: owner, blockTag: "pending" });
  const estimated = await publicClient.estimateGas({
    account: owner,
    to: tx.to,
    data: tx.data ?? "0x",
    value: tx.value ?? BigInt(0),
  });
  const gas = estimated + estimated / BigInt(10);
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const fees = await publicClient.estimateFeesPerGas();
  const baseFee = block.baseFeePerGas ?? BigInt(0);
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? BigInt(1_000_000_000);
  const maxFeePerGas = baseFee + maxPriorityFeePerGas * 2n;
  const reserved = (tx.value ?? BigInt(0)) + gas * maxFeePerGas;
  await ensureNativeForTx(owner, publicClient, reserved);

  const prepared: TransactionSerializable = {
    chainId: DEPLOYMENT_CHAIN_ID,
    to: tx.to,
    data: tx.data ?? "0x",
    value: tx.value ?? BigInt(0),
    nonce,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    type: "eip1559",
  };

  try {
    await publicClient.call({
      account: owner,
      to: tx.to,
      data: tx.data ?? "0x",
      value: tx.value ?? BigInt(0),
    });
  } catch (e) {
    throw new Error(formatUserTxError(e, "Transaction would revert. Check seed, times, and approval."));
  }

  const signed = await paraRestSignTransaction(mapping.walletId, prepared);
  try {
    const hash = await withRpcRetry(() =>
      publicClient.sendRawTransaction({ serializedTransaction: pickSignedTx(signed) }),
    );
    const receipt = await withRpcRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { hash, receipt };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    if (/insufficient balance/i.test(raw)) {
      const bal = await publicClient.getBalance({ address: owner });
      throw new Error(
        `Not enough MON for gas. Need ~${formatEther(reserved)} MON reserved, wallet has ${formatEther(bal)} MON.`,
      );
    }
    throw new Error(formatUserTxError(e, "Transaction failed. Try again."));
  }
}

export async function createParaServerWallets({ owner }: { owner: `0x${string}` }) {
  const mapping = await getParaWalletByOwner(owner);
  if (!mapping) throw new Error(`No Para REST wallet for ${owner}`);
  await maybeTopUpGas(owner);

  const publicClient = createPublicClient({ chain: DEPLOYMENT_CHAIN, transport: http(rpcUrl()) });
  const account = toAccount({
    address: owner,
    async signMessage() {
      throw new Error("Para server wallet does not sign messages.");
    },
    async signTypedData() {
      throw new Error("Para server wallet does not sign typed data.");
    },
    async signTransaction(tx) {
      const signed = await paraRestSignTransaction(mapping.walletId, tx as TransactionSerializable);
      return pickSignedTx(signed);
    },
  });

  const walletClient = createWalletClient({
    account,
    chain: DEPLOYMENT_CHAIN,
    transport: http(rpcUrl()),
  });

  return { account, walletClient, publicClient };
}

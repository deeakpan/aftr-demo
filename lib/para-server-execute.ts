import {
  createPublicClient,
  createWalletClient,
  formatEther,
  parseEther,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEPLOYMENT_CHAIN,
  NATIVE_CURRENCY_SYMBOL,
  deploymentRpcUrl,
} from "@/lib/chain";
import { paraWalletFromSession } from "@/lib/para-server-session";
import { formatUserTxError } from "@/lib/tx-error";
import { deploymentHttpTransport } from "@/lib/rpc-transport";

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
  const publicClient = createPublicClient({ chain: DEPLOYMENT_CHAIN, transport: deploymentHttpTransport(rpcUrl()) });
  const bal = await publicClient.getBalance({ address: owner });
  const defaultMin =
    NATIVE_CURRENCY_SYMBOL === "ETH" ? "200000000000000" : "10000000000000000";
  const min = BigInt(process.env.MARKET_GAS_MIN_WEI ?? defaultMin);
  if (bal >= min) return;
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({
    account,
    chain: DEPLOYMENT_CHAIN,
    transport: deploymentHttpTransport(rpcUrl()),
  });
  const defaultTopup =
    NATIVE_CURRENCY_SYMBOL === "ETH" ? "500000000000000" : "20000000000000000";
  const amount = BigInt(process.env.MARKET_GAS_TOPUP_WEI ?? defaultTopup);
  const hash = await wallet.sendTransaction({ to: owner, value: amount });
  await publicClient.waitForTransactionReceipt({ hash });
}

const MAX_GAS_TOPUP =
  NATIVE_CURRENCY_SYMBOL === "ETH" ? parseEther("0.01") : parseEther("5");
const FUNDER_GAS_RESERVE =
  NATIVE_CURRENCY_SYMBOL === "ETH" ? parseEther("0.0002") : parseEther("0.02");

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
      `Not enough ${NATIVE_CURRENCY_SYMBOL} for gas. Need ~${formatEther(needed)} reserved, wallet has ${formatEther(bal)}.`,
    );
  }
  const funder = privateKeyToAccount(key);
  const funderBal = await publicClient.getBalance({ address: funder.address });
  const maxSend =
    funderBal > FUNDER_GAS_RESERVE ? funderBal - FUNDER_GAS_RESERVE : BigInt(0);
  const buffer = NATIVE_CURRENCY_SYMBOL === "ETH" ? parseEther("0.0005") : parseEther("0.05");
  let topup = shortfall + buffer;
  if (topup > MAX_GAS_TOPUP) topup = MAX_GAS_TOPUP;
  if (topup > maxSend) topup = maxSend;
  if (topup <= BigInt(0)) {
    throw new Error(
      `Not enough ${NATIVE_CURRENCY_SYMBOL} for gas. Need ~${formatEther(needed)} reserved, wallet has ${formatEther(bal)}.`,
    );
  }
  const wallet = createWalletClient({
    account: funder,
    chain: DEPLOYMENT_CHAIN,
    transport: deploymentHttpTransport(rpcUrl()),
  });
  const hash = await wallet.sendTransaction({ to: owner, value: topup });
  await publicClient.waitForTransactionReceipt({ hash });
  const after = await publicClient.getBalance({ address: owner });
  if (after < needed) {
    throw new Error(
      `Not enough ${NATIVE_CURRENCY_SYMBOL} for gas. Need ~${formatEther(needed)} reserved, wallet has ${formatEther(after)}.`,
    );
  }
}

async function withRpcRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 400));
    return fn();
  }
}

/** Import the client-exported Para session and broadcast a tx, same as themarinas-app. */
export async function sendViaParaSession(
  session: string,
  tx: { to: `0x${string}`; data?: Hex; value?: bigint },
  expectedOwner?: `0x${string}`,
) {
  const { walletClient, account, address } = await paraWalletFromSession(session);
  if (expectedOwner && address.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error("Para session does not match this account.");
  }

  const publicClient = createPublicClient({ chain: DEPLOYMENT_CHAIN, transport: deploymentHttpTransport(rpcUrl()) });
  await maybeTopUpGas(address);
  const estimated = await publicClient.estimateGas({
    account: address,
    to: tx.to,
    data: tx.data ?? "0x",
    value: tx.value ?? BigInt(0),
  });
  const gas = estimated + estimated / BigInt(10);
  const fees = await publicClient.estimateFeesPerGas();
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const baseFee = block.baseFeePerGas ?? fees.gasPrice ?? BigInt(1);
  const tipFloor = BigInt(1_000);
  const maxPriorityFeePerGas =
    fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > BigInt(0)
      ? fees.maxPriorityFeePerGas
      : tipFloor;
  const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
  const reserved = (tx.value ?? BigInt(0)) + gas * maxFeePerGas;
  await ensureNativeForTx(address, publicClient, reserved);

  try {
    await publicClient.call({
      account: address,
      to: tx.to,
      data: tx.data ?? "0x",
      value: tx.value ?? BigInt(0),
    });
  } catch (e) {
    throw new Error(formatUserTxError(e, "Transaction would revert. Check seed, times, and approval."));
  }

  const hash = await walletClient.sendTransaction({
    account,
    chain: DEPLOYMENT_CHAIN,
    to: tx.to,
    data: tx.data ?? "0x",
    value: tx.value ?? BigInt(0),
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  const receipt = await withRpcRetry(() => publicClient.waitForTransactionReceipt({ hash }));
  return { hash, receipt };
}

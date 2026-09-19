"use client";

import {
  encodeFunctionData,
  getAddress,
  isAddress,
  type Abi,
  type Hash,
  type Hex,
} from "viem";
import { exportParaSession } from "@/app/components/para-wallet-provider";
import { DEPLOYMENT_CHAIN_ID } from "@/lib/deployment";
import { useWalletAddress } from "@/lib/para-wallet";
import { formatUserTxError } from "@/lib/tx-error";
import { useAccount as useParaAccount } from "@getpara/react-sdk-lite";

export type SessionWriteContractParams = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  gas?: bigint;
  account?: `0x${string}`;
  walletClient?: { chain?: unknown; writeContract: (args: never) => Promise<Hash> } | null;
};

export async function sendViaParaClient(params: {
  owner: `0x${string}`;
  to: `0x${string}`;
  data?: Hex;
  value?: bigint;
}): Promise<Hash> {
  const session = await exportParaSession();
  const res = await fetch("/api/para/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session,
      owner: params.owner,
      to: params.to,
      data: params.data ?? "0x",
      value: params.value?.toString(),
    }),
  });
  const json = (await res.json()) as { hash?: string; error?: string };
  if (!res.ok || !json.hash) {
    throw new Error(formatUserTxError(json.error || "Transaction failed.", "Transaction failed. Try again."));
  }
  return json.hash as Hash;
}

export async function writeSessionContract(params: SessionWriteContractParams): Promise<Hash> {
  const owner = params.account as `0x${string}` | undefined;
  if (!owner) throw new Error("Connect wallet first.");

  if (params.walletClient) {
    return params.walletClient.writeContract({
      chain: params.walletClient.chain,
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      account: owner,
      value: params.value,
      gas: params.gas,
    } as never);
  }

  const data = encodeFunctionData({
    abi: params.abi,
    functionName: params.functionName as never,
    args: (params.args ?? []) as never,
  });
  return sendViaParaClient({
    owner,
    to: params.address,
    data,
    value: params.value,
  });
}

/** Signed-in identity: Para embedded wallet only (no MetaMask / wagmi inject). */
export function useSessionWallet() {
  const { isConnected: paraConnected } = useParaAccount();
  const paraAddressRaw = useWalletAddress();
  const paraAddress =
    paraConnected && paraAddressRaw && isAddress(paraAddressRaw)
      ? (getAddress(paraAddressRaw) as `0x${string}`)
      : undefined;

  return {
    address: paraAddress,
    chainId: DEPLOYMENT_CHAIN_ID,
    isPara: Boolean(paraAddress),
    isConnected: Boolean(paraAddress),
    walletClient: null,
    writeContract: (params: SessionWriteContractParams) =>
      writeSessionContract({
        ...params,
        account: params.account ?? paraAddress,
        walletClient: null,
      }),
  };
}

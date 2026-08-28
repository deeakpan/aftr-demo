"use client";

import {
  encodeFunctionData,
  type Abi,
  type Hash,
  type Hex,
} from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { DEPLOYMENT_CHAIN_ID } from "@/lib/deployment";
import { getParaWalletRecord } from "@/lib/para-wallet-record";
import { formatUserTxError } from "@/lib/tx-error";
import { getMe, useMe } from "@/lib/useMe";

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
  const record = getParaWalletRecord();
  const res = await fetch("/api/para/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner: params.owner,
      to: params.to,
      data: params.data ?? "0x",
      value: params.value?.toString(),
      walletId: record?.walletId,
    }),
  });
  const json = (await res.json()) as { hash?: string; error?: string };
  if (!res.ok || !json.hash) {
    throw new Error(formatUserTxError(json.error || "Transaction failed.", "Transaction failed. Try again."));
  }
  return json.hash as Hash;
}

function paraSessionOwner(): `0x${string}` | undefined {
  return getParaWalletRecord()?.owner ?? getMe();
}

export async function writeSessionContract(params: SessionWriteContractParams): Promise<Hash> {
  const me = paraSessionOwner();
  const owner = (params.account ?? me) as `0x${string}` | undefined;
  if (!owner) throw new Error("Connect wallet first.");

  if (me) {
    const data = encodeFunctionData({
      abi: params.abi,
      functionName: params.functionName as never,
      args: (params.args ?? []) as never,
    });
    return sendViaParaClient({
      owner: me,
      to: params.address,
      data,
      value: params.value,
    });
  }

  const walletClient = params.walletClient as
    | { chain?: unknown; writeContract: (args: never) => Promise<Hash> }
    | null
    | undefined;
  if (!walletClient) throw new Error("Connect wallet first.");
  return walletClient.writeContract({
    chain: walletClient.chain,
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
    account: owner,
    value: params.value,
    gas: params.gas,
  } as never);
}

/** Signed-in identity: Para API wallet B, else wagmi. */
export function useSessionWallet() {
  const me = useMe();
  const { address: wagmiAddress, chainId: wagmiChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const paraOwner = paraSessionOwner() ?? me;
  const address = paraOwner ?? wagmiAddress;
  const isPara = Boolean(paraOwner);

  return {
    address,
    chainId: isPara ? DEPLOYMENT_CHAIN_ID : wagmiChainId,
    isPara,
    isConnected: Boolean(address),
    walletClient,
    writeContract: (params: SessionWriteContractParams) =>
      writeSessionContract({
        ...params,
        account: params.account ?? address,
        walletClient: walletClient as SessionWriteContractParams["walletClient"],
      }),
  };
}

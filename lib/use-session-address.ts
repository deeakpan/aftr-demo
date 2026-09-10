"use client";

import { useAccount as useParaAccount } from "@getpara/react-sdk-lite";
import { getAddress, isAddress } from "viem";
import { useAccount as useWagmiAccount } from "wagmi";
import { useWalletAddress } from "@/lib/para-wallet";

/** Signed-in address: live Para wallet when `isConnected`, else wagmi. Never localStorage. */
export function useSessionAddress() {
  const { isConnected: paraConnected } = useParaAccount();
  const paraAddressRaw = useWalletAddress();
  const { address: wagmiAddress } = useWagmiAccount();

  const paraAddress =
    paraConnected && paraAddressRaw && isAddress(paraAddressRaw)
      ? (getAddress(paraAddressRaw) as `0x${string}`)
      : undefined;

  const sessionAddress = paraAddress ?? wagmiAddress;

  return {
    sessionAddress,
    isPara: Boolean(paraAddress),
    isConnected: Boolean(sessionAddress),
  };
}

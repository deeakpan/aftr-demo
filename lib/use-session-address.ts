"use client";

import { useAccount as useParaAccount } from "@getpara/react-sdk-lite";
import { getAddress, isAddress } from "viem";
import { useWalletAddress } from "@/lib/para-wallet";

/** Signed-in address from Para embedded wallet only — never injected MetaMask. */
export function useSessionAddress() {
  const { isConnected: paraConnected } = useParaAccount();
  const paraAddressRaw = useWalletAddress();

  const paraAddress =
    paraConnected && paraAddressRaw && isAddress(paraAddressRaw)
      ? (getAddress(paraAddressRaw) as `0x${string}`)
      : undefined;

  return {
    sessionAddress: paraAddress,
    isPara: Boolean(paraAddress),
    isConnected: Boolean(paraAddress),
  };
}

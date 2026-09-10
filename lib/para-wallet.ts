"use client";

import { useAccount, useWalletState } from "@getpara/react-sdk-lite";

/** Same address resolution as themarinas-app `useWalletAddress`. */
export function useWalletAddress() {
  const { selectedWallet } = useWalletState();
  const { embedded, external } = useAccount();

  return (
    selectedWallet.address ??
    embedded?.wallets?.[0]?.address ??
    external?.evm?.address ??
    undefined
  );
}

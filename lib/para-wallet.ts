"use client";

import { useAccount, useWalletState } from "@getpara/react-sdk-lite";

/**
 * Embedded Para wallet only. Never return MetaMask/injected `external.evm`
 * — that made page visits look like a silent MetaMask sign-in.
 */
export function useWalletAddress() {
  const { selectedWallet } = useWalletState();
  const { embedded } = useAccount();

  return selectedWallet.address ?? embedded?.wallets?.[0]?.address ?? undefined;
}

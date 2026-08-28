"use client";

import { useAccount as useWagmiAccount } from "wagmi";
import { useParaWalletRecord } from "@/lib/para-wallet-record";
import { useParaSessionContext } from "@/app/components/para-session-context";
import { isParaLoginRequested } from "@/lib/para-login-request";
import { useMe } from "@/lib/useMe";

/** Signed-in address for header, profile, and trades — Para API wallet preferred. */
export function useSessionAddress() {
  const me = useMe();
  const paraRecord = useParaWalletRecord();
  const { address: wagmiAddress } = useWagmiAccount();
  const { paraAuthed, bridgeStatus } = useParaSessionContext();

  const sessionAddress = me ?? paraRecord?.owner ?? wagmiAddress;
  // Only show header spinner after user clicked Sign in — not on passive Para cookie restore.
  const isParaSigningIn =
    isParaLoginRequested() &&
    paraAuthed &&
    !sessionAddress &&
    bridgeStatus === "registering";

  return {
    sessionAddress,
    isPara: Boolean(me ?? paraRecord?.owner),
    isConnected: Boolean(sessionAddress),
    isParaSigningIn,
  };
}

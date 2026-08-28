"use client";

import { useAccount as useWagmiAccount } from "wagmi";
import { useParaWalletRecord } from "@/lib/para-wallet-record";
import { useParaSessionContext } from "@/app/components/para-session-context";
import { isParaLoginRequested } from "@/lib/para-login-request";
import { useSignInAttempt } from "@/lib/use-sign-in-attempt";
import { useMe } from "@/lib/useMe";

/** Signed-in address for header, profile, and trades — Para API wallet preferred. */
export function useSessionAddress() {
  const me = useMe();
  const paraRecord = useParaWalletRecord();
  const { address: wagmiAddress } = useWagmiAccount();
  const { paraAuthed, bridgeStatus } = useParaSessionContext();
  const signInAttempt = useSignInAttempt();
  const loginRequested = isParaLoginRequested();

  const sessionAddress = me ?? paraRecord?.owner ?? wagmiAddress;

  const isParaConnecting =
    !sessionAddress &&
    bridgeStatus !== "failed" &&
    (bridgeStatus === "registering" || paraAuthed);

  const isParaSigningIn = loginRequested && isParaConnecting;

  /** Para cookie exists but bridge is idle (e.g. export/register failed without marking failed). */
  const isParaStuck = paraAuthed && !sessionAddress && bridgeStatus === "idle";

  return {
    sessionAddress,
    isPara: Boolean(me ?? paraRecord?.owner),
    isConnected: Boolean(sessionAddress),
    isParaSigningIn,
    isParaConnecting,
    isParaStuck,
    signInAttempt,
  };
}

"use client";

import { clearParaLoginRequested } from "@/lib/para-login-request";
import { setParaWalletRecord } from "@/lib/para-wallet-record";
import { setMe } from "@/lib/useMe";

let signingOut = false;

export function isSigningOut() {
  return signingOut;
}

export async function signOutEverywhere(paraLogout?: () => Promise<void> | void) {
  signingOut = true;
  try {
    await paraLogout?.();
  } catch {
    // still clear local session
  }
  setParaWalletRecord(null);
  setMe(undefined);
  clearParaLoginRequested();
  signingOut = false;
}

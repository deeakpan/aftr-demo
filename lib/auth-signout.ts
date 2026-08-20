"use client";

import { setMe } from "@/lib/useMe";
import { setParaWalletRecord } from "@/lib/para-wallet-record";

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
  signingOut = false;
}

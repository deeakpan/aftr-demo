"use client";

import { useSyncExternalStore } from "react";
import { getSignInAttempt, subscribeParaLoginState } from "@/lib/para-login-request";

export function useSignInAttempt() {
  return useSyncExternalStore(subscribeParaLoginState, getSignInAttempt, () => 0);
}

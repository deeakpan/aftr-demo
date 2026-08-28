"use client";

/** User clicked Sign in — drives auth modal vs silent bridge. */
import { useSyncExternalStore } from "react";

let paraLoginRequested = false;
let signInAttempt = 0;
type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function markParaLoginRequested() {
  paraLoginRequested = true;
  signInAttempt += 1;
  emit();
}

export function isParaLoginRequested() {
  return paraLoginRequested;
}

export function getSignInAttempt() {
  return signInAttempt;
}

export function clearParaLoginRequested() {
  if (!paraLoginRequested) return;
  paraLoginRequested = false;
  emit();
}

export function useParaLoginRequested() {
  return useSyncExternalStore(
    subscribeParaLoginState,
    isParaLoginRequested,
    () => false,
  );
}

export function subscribeParaLoginState(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

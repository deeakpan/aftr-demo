"use client";

import { useSyncExternalStore } from "react";
import { getAddress, isAddress } from "viem";

const ME_KEY = "mondalore-para-me";

type Listener = () => void;
const listeners = new Set<Listener>();

function normalize(addr: string | undefined): `0x${string}` | undefined {
  const raw = addr?.trim();
  if (!raw || !isAddress(raw)) return undefined;
  try {
    return getAddress(raw) as `0x${string}`;
  } catch {
    return undefined;
  }
}

function readMe(): `0x${string}` | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return normalize(window.localStorage.getItem(ME_KEY) ?? undefined);
  } catch {
    return undefined;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function getMe(): `0x${string}` | undefined {
  return readMe();
}

export function setMe(next: string | undefined) {
  if (typeof window === "undefined") return;
  const normalized = normalize(next);
  try {
    if (!normalized) window.localStorage.removeItem(ME_KEY);
    else window.localStorage.setItem(ME_KEY, normalized);
  } catch {
    // ignore quota / private mode
  }
  emit();
}

export function useMe(): `0x${string}` | undefined {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    readMe,
    () => undefined,
  );
}

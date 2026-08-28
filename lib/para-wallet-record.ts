"use client";

import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export type ParaWalletRecord = {
  owner: `0x${string}`;
  walletId: string;
  paraUserId?: string | null;
  email?: string | null;
  updatedAt: number;
};

const KEY = "mondalore-para-wallet";

/** Stable snapshot for useSyncExternalStore — must not return new objects when data is unchanged. */
let cachedRaw: string | null | undefined;
let cachedSnapshot: ParaWalletRecord | null = null;

function readParaWalletRecord(): ParaWalletRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === cachedRaw) return cachedSnapshot;
    cachedRaw = raw;
    if (!raw) {
      cachedSnapshot = null;
      return null;
    }
    const parsed = JSON.parse(raw) as ParaWalletRecord;
    if (!parsed?.owner || !parsed?.walletId) {
      cachedSnapshot = null;
      return null;
    }
    cachedSnapshot = parsed;
    return cachedSnapshot;
  } catch {
    cachedRaw = null;
    cachedSnapshot = null;
    return null;
  }
}

export function getParaWalletRecord(): ParaWalletRecord | null {
  return readParaWalletRecord();
}

export function setParaWalletRecord(record: ParaWalletRecord | null) {
  if (typeof window === "undefined") return;
  try {
    if (!record) {
      if (cachedRaw === null && cachedSnapshot === null) return;
      window.localStorage.removeItem(KEY);
      cachedRaw = null;
      cachedSnapshot = null;
    } else {
      const raw = JSON.stringify(record);
      if (raw === cachedRaw) return;
      window.localStorage.setItem(KEY, raw);
      cachedRaw = raw;
      cachedSnapshot = record;
    }
  } catch {
    // ignore
  }
  emit();
}

export function useParaWalletRecord(): ParaWalletRecord | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    readParaWalletRecord,
    () => null,
  );
}

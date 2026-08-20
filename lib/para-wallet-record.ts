"use client";

export type ParaWalletRecord = {
  owner: `0x${string}`;
  walletId: string;
  paraUserId?: string | null;
  email?: string | null;
  updatedAt: number;
};

const KEY = "mondalore-para-wallet";

export function getParaWalletRecord(): ParaWalletRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ParaWalletRecord;
    if (!parsed?.owner || !parsed?.walletId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setParaWalletRecord(record: ParaWalletRecord | null) {
  if (typeof window === "undefined") return;
  try {
    if (!record) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // ignore
  }
}

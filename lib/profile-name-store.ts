"use client";

import { useSyncExternalStore } from "react";
import { getAddress, isAddress } from "viem";

type Listener = () => void;
const listeners = new Set<Listener>();

function profileCacheKey(address: string) {
  return `aftrmarket-profile-name:${address.toLowerCase()}`;
}

function normalizeAddress(address: string): string | null {
  const raw = address?.trim();
  if (!raw || !isAddress(raw)) return null;
  try {
    return getAddress(raw).toLowerCase();
  } catch {
    return null;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function getCachedProfileName(address: string): string | null {
  if (typeof window === "undefined") return null;
  const key = normalizeAddress(address);
  if (!key) return null;
  try {
    const v = window.localStorage.getItem(profileCacheKey(key))?.trim();
    return v || null;
  } catch {
    return null;
  }
}

export function setCachedProfileName(address: string, name: string): void {
  if (typeof window === "undefined") return;
  const key = normalizeAddress(address);
  if (!key) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(profileCacheKey(key), trimmed);
  } catch {
    // ignore quota / private mode
  }
  emit();
}

export function clearCachedProfileName(address: string): void {
  if (typeof window === "undefined") return;
  const key = normalizeAddress(address);
  if (!key) return;
  try {
    window.localStorage.removeItem(profileCacheKey(key));
  } catch {
    // ignore
  }
  emit();
}

/** Reactive profile display name for the connected wallet (localStorage-backed). */
export function useProfileName(address: string | undefined): string {
  const normalized = address && isAddress(address) ? address.toLowerCase() : "";
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => (normalized ? getCachedProfileName(normalized) ?? "" : ""),
    () => "",
  );
}

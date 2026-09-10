"use client";

export async function signOutEverywhere(paraLogout?: () => Promise<void> | void) {
  try {
    await paraLogout?.();
  } catch {
    // still continue local UI reset
  }
}

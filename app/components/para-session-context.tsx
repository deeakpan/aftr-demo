"use client";

import { createContext, useContext, type ReactNode } from "react";

export type ParaBridgeStatus = "idle" | "registering" | "failed";

export type ParaSessionContextValue = {
  paraAuthed: boolean;
  bridgeStatus: ParaBridgeStatus;
  bridgeError: string | null;
  setParaAuthed: (next: boolean) => void;
  setBridgeState: (status: ParaBridgeStatus, error?: string | null) => void;
};

export const ParaSessionContext = createContext<ParaSessionContextValue | null>(null);

export function ParaSessionProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ParaSessionContextValue;
}) {
  return <ParaSessionContext.Provider value={value}>{children}</ParaSessionContext.Provider>;
}

export function useParaSessionContext(): ParaSessionContextValue {
  const ctx = useContext(ParaSessionContext);
  if (!ctx) {
    return {
      paraAuthed: false,
      bridgeStatus: "idle",
      bridgeError: null,
      setParaAuthed: () => {},
      setBridgeState: () => {},
    };
  }
  return ctx;
}

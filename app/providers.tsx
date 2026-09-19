"use client";

import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Config } from "wagmi";
import { WagmiProvider } from "wagmi";
import { ParaWalletProvider } from "@/app/components/para-wallet-provider";

const queryClient = new QueryClient();

function WagmiApp({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("./wagmi-config.client")
      .then(({ wagmiConfig }) => {
        if (!cancelled) setConfig(wagmiConfig);
      })
      .catch((err) => {
        console.error("[wagmi] config load failed", err);
        if (!cancelled) {
          setBootError(err instanceof Error ? err.message : "Wallet config failed to load.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (bootError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--background)] px-6 text-center">
        <p className="text-sm font-semibold text-[var(--foreground)]">Wallet failed to start</p>
        <p className="max-w-md text-xs text-[var(--muted)]">{bootError}</p>
        <button
          type="button"
          className="rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--background)]"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }

  if (!config) {
    return (
      <div
        className="min-h-screen bg-[var(--background)]"
        aria-busy="true"
        aria-label="Loading wallet"
      />
    );
  }

  return (
    <WagmiProvider config={config} reconnectOnMount={false}>
      {children}
    </WagmiProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ParaWalletProvider>
        <WagmiApp>{children}</WagmiApp>
      </ParaWalletProvider>
    </QueryClientProvider>
  );
}

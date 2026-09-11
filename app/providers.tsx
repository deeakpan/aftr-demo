"use client";

import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWeb3Modal } from "@web3modal/wagmi/react";
import type { Config } from "wagmi";
import { WagmiProvider } from "wagmi";
import { ParaWalletProvider } from "@/app/components/para-wallet-provider";

declare global {
  interface Window {
    __aftr_w3m_initialized__?: boolean;
  }
}

const queryClient = new QueryClient();

function initWeb3Modal(config: Config, projectId: string) {
  if (typeof window === "undefined") return;
  if (window.__aftr_w3m_initialized__) return;
  try {
    createWeb3Modal({
      wagmiConfig: config,
      projectId,
      themeMode: "dark",
      themeVariables: {
        "--w3m-accent": "#7c3aed",
        "--w3m-color-mix": "#000000",
        "--w3m-color-mix-strength": 45,
        "--w3m-border-radius-master": "16px",
        "--w3m-font-size-master": "10px",
        "--w3m-font-family": "var(--font-geist-sans), Arial, Helvetica, sans-serif",
        "--w3m-z-index": 1000,
      },
    });
    window.__aftr_w3m_initialized__ = true;
  } catch (err) {
    console.error("[wagmi] Web3Modal init failed", err);
  }
}

function WagmiApp({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("./wagmi-config.client")
      .then(({ wagmiConfig, hasWalletConnectProjectId, walletConnectProjectId }) => {
        if (cancelled) return;
        if (hasWalletConnectProjectId) {
          initWeb3Modal(wagmiConfig, walletConnectProjectId);
        }
        setConfig(wagmiConfig);
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

  return <WagmiProvider config={config}>{children}</WagmiProvider>;
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

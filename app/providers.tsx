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
}

export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    void import("./wagmi-config.client").then(({ wagmiConfig, walletConnectProjectId }) => {
      initWeb3Modal(wagmiConfig, walletConnectProjectId);
      setConfig(wagmiConfig);
      setReady(true);
    });
  }, []);

  if (!ready || !config) {
    return (
      <div
        className="min-h-screen bg-[var(--background)]"
        aria-busy="true"
        aria-label="Loading wallet"
      />
    );
  }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ParaWalletProvider>{children}</ParaWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

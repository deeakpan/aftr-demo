"use client";

import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWeb3Modal, defaultWagmiConfig } from "@web3modal/wagmi/react";
import { baseSepolia } from "wagmi/chains";
import { WagmiProvider } from "wagmi";

const envProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
export const hasWalletConnectProjectId = envProjectId.length > 0;
const projectId = hasWalletConnectProjectId ? envProjectId : "demo-project-id";

const metadata = {
  name: "AFTRMarket",
  description: "AFTRMarket prediction market UI",
  url: "https://aftrmarket.local",
  icons: [],
};

const chains = [baseSepolia] as const;
const wagmiConfig = defaultWagmiConfig({ chains, projectId, metadata });

declare global {
  interface Window {
    __aftr_w3m_initialized__?: boolean;
  }
}

function ensureWeb3ModalInitialized() {
  if (typeof window === "undefined") return false;
  if (window.__aftr_w3m_initialized__) return true;
  createWeb3Modal({
    wagmiConfig,
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
  return true;
}

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  const [isModalReady, setIsModalReady] = useState(false);

  useEffect(() => {
    setIsModalReady(ensureWeb3ModalInitialized());
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{isModalReady ? children : null}</QueryClientProvider>
    </WagmiProvider>
  );
}

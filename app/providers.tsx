"use client";

import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWeb3Modal, defaultWagmiConfig } from "@web3modal/wagmi/react";
import { base } from "wagmi/chains";
import { WagmiProvider } from "wagmi";

const projectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
export const hasWalletConnectProjectId = projectId.length > 0;

const metadata = {
  name: "AFTRMarket",
  description: "AFTRMarket prediction market UI",
  url: "https://aftrmarket.local",
  icons: [],
};

const chains = [base] as const;
const wagmiConfig = defaultWagmiConfig({
  chains,
  projectId: hasWalletConnectProjectId ? projectId : "demo-project-id",
  metadata,
});

if (hasWalletConnectProjectId) {
  createWeb3Modal({
    wagmiConfig,
    projectId,
    chains,
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
}

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

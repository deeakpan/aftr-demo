"use client";

import { cookieStorage, createConfig, createStorage } from "wagmi";
import { deploymentRpcUrl, DEPLOYMENT_CHAIN, monadTestnet, robinhoodMainnet, unichainSepolia } from "@/lib/chain";
import { deploymentHttpTransport } from "@/lib/rpc-transport";

/**
 * Read-only wagmi config for contract reads. No injected/WC connectors —
 * MetaMask must never auto-reconnect or request signatures on page visit.
 * Auth is Para embedded only.
 */
const rpc = deploymentRpcUrl();
const transports = {
  [monadTestnet.id]: deploymentHttpTransport(rpc),
  [robinhoodMainnet.id]: deploymentHttpTransport(rpc),
  [unichainSepolia.id]: deploymentHttpTransport(rpc),
} as const;

export const hasWalletConnectProjectId = false;
export const walletConnectProjectId = "";

export const wagmiConfig = createConfig({
  chains: [DEPLOYMENT_CHAIN],
  connectors: [],
  ssr: false,
  multiInjectedProviderDiscovery: false,
  storage: createStorage({
    storage: cookieStorage,
    key: "aftr-wagmi",
  }),
  transports,
});

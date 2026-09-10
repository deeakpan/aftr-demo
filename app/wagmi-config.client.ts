"use client";

import { defaultWagmiConfig } from "@web3modal/wagmi/react/config";
import { cookieStorage, createConfig, createStorage } from "wagmi";
import { deploymentRpcUrl, DEPLOYMENT_CHAIN, monadTestnet, robinhoodMainnet, unichainSepolia } from "@/lib/chain";
import { deploymentHttpTransport } from "@/lib/rpc-transport";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/product";

const envProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
const envAppUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
const appUrl =
  envAppUrl || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

export const hasWalletConnectProjectId = envProjectId.length > 0;
export const walletConnectProjectId = envProjectId;

const metadata = {
  name: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTION,
  url: appUrl,
  icons: [] as string[],
};

const chains = [DEPLOYMENT_CHAIN] as const;
const rpc = deploymentRpcUrl();
const transports = {
  [monadTestnet.id]: deploymentHttpTransport(rpc),
  [robinhoodMainnet.id]: deploymentHttpTransport(rpc),
  [unichainSepolia.id]: deploymentHttpTransport(rpc),
} as const;

/** Client-only wagmi config. Para sign-in does not need a WalletConnect project id. */
export const wagmiConfig = hasWalletConnectProjectId
  ? defaultWagmiConfig({
      chains,
      projectId: walletConnectProjectId,
      metadata,
      ssr: false,
      storage: createStorage({
        storage: cookieStorage,
        key: "aftr-wagmi",
      }),
      auth: { email: false, socials: [] },
      transports,
    })
  : createConfig({
      chains,
      connectors: [],
      ssr: false,
      storage: createStorage({
        storage: cookieStorage,
        key: "aftr-wagmi",
      }),
      transports,
    });

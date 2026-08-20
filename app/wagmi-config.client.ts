"use client";

import { defaultWagmiConfig } from "@web3modal/wagmi/react/config";
import { cookieStorage, createStorage } from "wagmi";
import { http } from "wagmi";
import { deploymentRpcUrl, DEPLOYMENT_CHAIN } from "@/lib/chain";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/product";

const envProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
const envAppUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
const appUrl =
  envAppUrl || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

export const hasWalletConnectProjectId = envProjectId.length > 0;
export const walletConnectProjectId = hasWalletConnectProjectId ? envProjectId : "demo-project-id";

const metadata = {
  name: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTION,
  url: appUrl,
  icons: [] as string[],
};

const chains = [DEPLOYMENT_CHAIN] as const;

/** Client-only wagmi config (avoids indexedDB / WalletConnect init during SSR). */
export const wagmiConfig = defaultWagmiConfig({
  chains,
  projectId: walletConnectProjectId,
  metadata,
  ssr: false,
  storage: createStorage({
    storage: cookieStorage,
    key: "aftr-wagmi",
  }),
  auth: { email: false, socials: [] },
  /** Same RPC as chain definition — used for reads; wallet uses its own RPC when signing. */
  transports: { [DEPLOYMENT_CHAIN.id]: http(deploymentRpcUrl()) },
});

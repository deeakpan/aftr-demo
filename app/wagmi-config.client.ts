"use client";

import { defaultWagmiConfig } from "@web3modal/wagmi/react/config";
import { cookieStorage, createStorage } from "wagmi";
import { http } from "wagmi";
import { monadTestnet } from "@/lib/chain";

const envProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").trim();

export const hasWalletConnectProjectId = envProjectId.length > 0;
export const walletConnectProjectId = hasWalletConnectProjectId ? envProjectId : "demo-project-id";

const metadata = {
  name: "Mondalore Market",
  description: "The planet of predictions — onchain markets on Monad",
  url: appUrl,
  icons: [] as string[],
};

const customRpc = (process.env.NEXT_PUBLIC_RPC_URL ?? "").trim();
const chains = [monadTestnet] as const;

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
  ...(customRpc ? { transports: { [monadTestnet.id]: http(customRpc) } } : {}),
});

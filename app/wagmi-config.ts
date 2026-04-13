import { defaultWagmiConfig } from "@web3modal/wagmi/react/config";
import { cookieStorage, createStorage } from "wagmi";
import { baseSepolia } from "wagmi/chains";

const envProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").trim();
export const hasWalletConnectProjectId = envProjectId.length > 0;
/** Passed to Web3Modal and wagmi WalletConnect connector. */
export const walletConnectProjectId = hasWalletConnectProjectId ? envProjectId : "demo-project-id";

const metadata = {
  name: "AFTRMarket",
  description: "AFTRMarket prediction market UI",
  url: appUrl,
  icons: [] as string[],
};

const chains = [baseSepolia] as const;

/**
 * Single wagmi config shared by Web3Modal + WagmiProvider on the client.
 * `ssr` + `storage` avoid stale connections where `connector.getChainId` is missing after refresh.
 * Auth connector (email/social) is disabled to reduce incompatible connector edge cases.
 */
export const wagmiConfig = defaultWagmiConfig({
  chains,
  projectId: walletConnectProjectId,
  metadata,
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
    key: "aftr-wagmi",
  }),
  auth: { email: false, socials: [] },
});

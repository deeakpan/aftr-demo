import { defineChain } from "viem";

/** Canonical Multicall3 on Monad testnet + mainnet (Monad docs). */
export const MONAD_MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
  contracts: {
    multicall3: {
      address: MONAD_MULTICALL3_ADDRESS,
    },
  },
});

export const DEPLOYMENT_CHAIN = monadTestnet;
export const DEPLOYMENT_CHAIN_ID = monadTestnet.id;
export const DEPLOYMENT_NETWORK_LABEL = "Monad Testnet";
export const DEPLOYMENT_RPC_URL = "https://testnet-rpc.monad.xyz/";

export function deploymentRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_RPC_URL?.trim() ||
    process.env.RPC_URL?.trim() ||
    DEPLOYMENT_RPC_URL
  );
}

export function txExplorerUrl(txHash: string): string {
  return `${DEPLOYMENT_CHAIN.blockExplorers!.default.url}/tx/${txHash}`;
}

export function wrongNetworkMessage(chainId: number = DEPLOYMENT_CHAIN_ID): string {
  return `Switch to ${DEPLOYMENT_NETWORK_LABEL} (${chainId}).`;
}

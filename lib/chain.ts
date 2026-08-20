import { defineChain } from "viem";

/** Canonical Multicall3 (EVM chains). */
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
export const MONAD_MULTICALL3_ADDRESS = MULTICALL3_ADDRESS;

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
      address: MULTICALL3_ADDRESS,
    },
  },
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.robinhood.com" },
  },
  contracts: {
    multicall3: {
      address: MULTICALL3_ADDRESS,
    },
  },
});

const CHAIN_BY_ID = {
  [monadTestnet.id]: monadTestnet,
  [robinhoodMainnet.id]: robinhoodMainnet,
} as const;

function configuredChainId(): number {
  const raw =
    process.env.NEXT_PUBLIC_DEPLOYMENT_CHAIN_ID?.trim() ||
    process.env.DEPLOYMENT_CHAIN_ID?.trim() ||
    String(robinhoodMainnet.id);
  const id = Number(raw);
  return id in CHAIN_BY_ID ? id : robinhoodMainnet.id;
}

export const DEPLOYMENT_CHAIN_ID = configuredChainId();
export const DEPLOYMENT_CHAIN = CHAIN_BY_ID[DEPLOYMENT_CHAIN_ID as keyof typeof CHAIN_BY_ID] ?? robinhoodMainnet;
export const DEPLOYMENT_NETWORK_LABEL = DEPLOYMENT_CHAIN.name;
export const NATIVE_CURRENCY_SYMBOL = DEPLOYMENT_CHAIN.nativeCurrency.symbol;
export const DEPLOYMENT_RPC_URL =
  DEPLOYMENT_CHAIN_ID === monadTestnet.id
    ? "https://testnet-rpc.monad.xyz/"
    : "https://rpc.mainnet.chain.robinhood.com";

function envRpcMatchesDeployment(url: string): boolean {
  const lower = url.toLowerCase();
  if (DEPLOYMENT_CHAIN_ID === robinhoodMainnet.id) {
    return lower.includes("robinhood");
  }
  if (DEPLOYMENT_CHAIN_ID === monadTestnet.id) {
    return lower.includes("monad");
  }
  return true;
}

export function deploymentRpcUrl(): string {
  const env =
    process.env.NEXT_PUBLIC_RPC_URL?.trim() ||
    process.env.RPC_URL?.trim() ||
    "";
  if (env && envRpcMatchesDeployment(env)) return env;
  return DEPLOYMENT_RPC_URL;
}

/** Pons V2 is only on Robinhood Chain — never use a Monad RPC for these reads. */
export function ponsRpcUrl(): string {
  return "https://rpc.mainnet.chain.robinhood.com";
}

export function txExplorerUrl(txHash: string): string {
  return `${DEPLOYMENT_CHAIN.blockExplorers!.default.url}/tx/${txHash}`;
}

export function wrongNetworkMessage(chainId: number = DEPLOYMENT_CHAIN_ID): string {
  return `Switch to ${DEPLOYMENT_NETWORK_LABEL} (${chainId}).`;
}

import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEPLOYMENT_CHAIN_ID,
  DEPLOYMENT_NETWORK_LABEL,
  MULTICALL3_ADDRESS,
  NATIVE_CURRENCY_SYMBOL,
  deploymentRpcUrl,
} from "@/lib/chain";
import { rpcFetch } from "@/lib/rpc-transport";

function resolverHttpTransport(url: string) {
  return http(url, {
    timeout: 25_000,
    retryCount: 2,
    retryDelay: 600,
    fetchFn: rpcFetch,
    fetchOptions: {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    },
  });
}

export function resolverChain() {
  const rpc = deploymentRpcUrl();
  return defineChain({
    id: DEPLOYMENT_CHAIN_ID,
    name: DEPLOYMENT_NETWORK_LABEL,
    nativeCurrency: { name: NATIVE_CURRENCY_SYMBOL, symbol: NATIVE_CURRENCY_SYMBOL, decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    contracts: {
      multicall3: { address: MULTICALL3_ADDRESS },
    },
  });
}

export function publicClient() {
  const chain = resolverChain();
  return createPublicClient({
    chain,
    transport: resolverHttpTransport(deploymentRpcUrl()),
  });
}

export function resolverAccount() {
  const raw = (process.env.PRIVATE_KEY || process.env.MARKET_GAS_PRIVATE_KEY || "").trim();
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return privateKeyToAccount(key);
}

export function walletClient() {
  const account = resolverAccount();
  if (!account) return null;
  const chain = resolverChain();
  return createWalletClient({
    account,
    chain,
    transport: resolverHttpTransport(deploymentRpcUrl()),
  });
}

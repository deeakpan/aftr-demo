import { Para as ParaServer } from "@getpara/server-sdk";
import {
  createParaViemAccount,
  createParaViemClient,
} from "@getpara/viem-v2-integration";
import { DEPLOYMENT_CHAIN, deploymentRpcUrl } from "@/lib/chain";
import { deploymentHttpTransport } from "@/lib/rpc-transport";
import type { Address } from "viem";

/**
 * ParaServer must use the public API key (prod_… / beta_…), not sk_prod_….
 * Same rule as themarinas-app.
 */
function paraPublicApiKey(): string {
  const key =
    process.env.PARA_API_KEY ??
    process.env.NEXT_PUBLIC_PARA_API_KEY ??
    "";
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error("Para API key missing on the server. Set PARA_API_KEY or NEXT_PUBLIC_PARA_API_KEY.");
  }
  if (trimmed.startsWith("sk_")) {
    throw new Error("Para server signing needs the public prod_… key, not PARA_API_SECRET (sk_prod_…).");
  }
  return trimmed;
}

function createParaServer() {
  return new ParaServer(paraPublicApiKey());
}

function rpcUrl() {
  return process.env.MARKET_RPC_URL?.trim() || deploymentRpcUrl();
}

/**
 * Import a client-exported Para session and return a deployment-chain wallet client.
 */
export async function paraWalletFromSession(session: string) {
  const para = createParaServer();
  await para.importSession(session);
  if (!(await para.isSessionActive())) {
    throw new Error("Para session expired — reconnect and try again");
  }
  await para.keepSessionAlive().catch(() => undefined);

  const paraCore = para as unknown as Parameters<typeof createParaViemClient>[0];
  const account = createParaViemAccount({ para: paraCore });
  // Same resilient RPC transport as estimate/broadcast — bare http() was flaky on publicnode.
  const walletClient = createParaViemClient(paraCore, {
    account,
    chain: DEPLOYMENT_CHAIN,
    transport: deploymentHttpTransport(rpcUrl()),
  });

  return { para, account, walletClient, address: account.address as Address };
}

import { fpmmFactoryAddress } from "@/lib/market-factory";
import { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL, NATIVE_CURRENCY_SYMBOL } from "@/lib/chain";
import { resolverAccount } from "./clients";
import { factoryAddress, readPonsResolutionAdmin } from "./factory";
import { getSubgraphUrl } from "./subgraph";

export async function resolverStatus() {
  const account = resolverAccount();
  const onchainAdmin = await readPonsResolutionAdmin().catch(() => null);
  const factory = factoryAddress();
  return {
    network: DEPLOYMENT_NETWORK_LABEL,
    chainId: DEPLOYMENT_CHAIN_ID,
    nativeCurrency: NATIVE_CURRENCY_SYMBOL,
    subgraphUrl: getSubgraphUrl(),
    factory,
    factories: {
      fpmm: fpmmFactoryAddress(),
    },
    ponsResolutionAdmin: onchainAdmin,
    tokenResolutionAdmin: onchainAdmin,
    botWallet: account?.address ?? null,
    walletMatchesAdmin:
      Boolean(account?.address && onchainAdmin) &&
      account!.address.toLowerCase() === onchainAdmin!.toLowerCase(),
    pollMs: Number(process.env.RESOLVER_POLL_MS ?? 30_000),
  };
}

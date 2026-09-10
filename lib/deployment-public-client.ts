import { type Abi, createPublicClient } from "viem";
import { DEPLOYMENT_CHAIN, DEPLOYMENT_NETWORK_LABEL, deploymentRpcUrl } from "@/lib/chain";
import { deploymentHttpTransport } from "@/lib/rpc-transport";

/** Chain reads — always uses deployment RPC, independent of wallet chain. */
export const deploymentPublicClient = createPublicClient({
  chain: DEPLOYMENT_CHAIN,
  transport: deploymentHttpTransport(deploymentRpcUrl()),
});

export async function assertMarketContract(marketAddress: `0x${string}`): Promise<void> {
  const code = await deploymentPublicClient.getBytecode({ address: marketAddress });
  if (!code || code === "0x") {
    throw new Error(`Market contract not found on ${DEPLOYMENT_NETWORK_LABEL}.`);
  }
}

export async function readMarketPrice(
  marketAddress: `0x${string}`,
  outcomeIndex: number,
  abi: Abi,
): Promise<bigint> {
  await assertMarketContract(marketAddress);
  return deploymentPublicClient.readContract({
    address: marketAddress,
    abi,
    functionName: "priceOf",
    args: [outcomeIndex],
  }) as Promise<bigint>;
}

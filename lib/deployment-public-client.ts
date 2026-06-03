import { type Abi, createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

function deploymentRpcUrl(): string {
  // Browser reads use the public endpoint — Alchemy keys are often server-only / domain-restricted.
  if (typeof window !== "undefined") {
    return "https://sepolia.base.org";
  }
  return (
    process.env.RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_RPC_URL?.trim() ||
    "https://sepolia.base.org"
  );
}

/** Base Sepolia reads — always uses deployment RPC, independent of wallet chain. */
export const deploymentPublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(deploymentRpcUrl()),
});

export async function assertMarketContract(marketAddress: `0x${string}`): Promise<void> {
  const code = await deploymentPublicClient.getBytecode({ address: marketAddress });
  if (!code || code === "0x") {
    throw new Error("Market contract not found on Base Sepolia.");
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

import { parseAbi, type Address, type PublicClient } from "viem";
import { fpmmFactoryAddress } from "@/lib/market-factory";

const IS_MARKET_ABI = parseAbi(["function isMarket(address) view returns (bool)"]);

export async function isFpmmMarket(
  client: PublicClient,
  marketAddress: Address,
): Promise<boolean> {
  const factory = fpmmFactoryAddress();
  if (!factory) return false;
  try {
    return (await client.readContract({
      address: factory,
      abi: IS_MARKET_ABI,
      functionName: "isMarket",
      args: [marketAddress],
    })) as boolean;
  } catch {
    return false;
  }
}

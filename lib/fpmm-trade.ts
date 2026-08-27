import type { Address, PublicClient } from "viem";
import { parseAbi } from "viem";
import { calcBuyAmount, calcSellAmount } from "@/lib/fpmm-math";
import { TRADE_FEE_TOTAL_BPS, tradeFeesFromAmount } from "@/lib/trade-fees";

const FPMM_POOL_ABI = parseAbi([
  "function numOutcomes() view returns (uint8)",
  "function poolBalances(uint256 outcomeIndex) view returns (uint256)",
]);

async function readFpmmPools(
  client: PublicClient,
  market: Address,
): Promise<bigint[]> {
  const numOutcomes = Number(
    await client.readContract({
      address: market,
      abi: FPMM_POOL_ABI,
      functionName: "numOutcomes",
    }),
  );
  if (!Number.isFinite(numOutcomes) || numOutcomes < 2) {
    throw new Error("Invalid market outcomes.");
  }

  return Promise.all(
    Array.from({ length: numOutcomes }, (_, i) =>
      client.readContract({
        address: market,
        abi: FPMM_POOL_ABI,
        functionName: "poolBalances",
        args: [BigInt(i)],
      }) as Promise<bigint>,
    ),
  );
}

/** Expected outcome tokens from an FPMM `buy` (matches on-chain fee + AMM math). */
export async function estimateFpmmBuyTokensOut(
  client: PublicClient,
  market: Address,
  outcomeIndex: number,
  investmentAmount: bigint,
): Promise<bigint> {
  const { netAmount } = tradeFeesFromAmount(investmentAmount);
  if (netAmount <= 0n) return 0n;
  const pools = await readFpmmPools(client, market);
  return calcBuyAmount(netAmount, outcomeIndex, pools, 0n);
}

/**
 * Outcome tokens burned for an FPMM `sell` with the given collateral `returnAmount`
 * (matches on-chain `calcSellAmount(..., TRADE_FEE_TOTAL_BPS)`).
 */
export async function estimateFpmmSellTokensIn(
  client: PublicClient,
  market: Address,
  outcomeIndex: number,
  returnAmount: bigint,
): Promise<bigint> {
  if (returnAmount <= 0n) return 0n;
  const pools = await readFpmmPools(client, market);
  return calcSellAmount(returnAmount, outcomeIndex, pools, BigInt(TRADE_FEE_TOTAL_BPS));
}

/** Largest `returnAmount` such that tokens burned ≤ `maxTokensIn`. */
export async function estimateMaxFpmmSellReturn(
  client: PublicClient,
  market: Address,
  outcomeIndex: number,
  maxTokensIn: bigint,
): Promise<bigint> {
  if (maxTokensIn <= 0n) return 0n;
  const pools = await readFpmmPools(client, market);
  const otherIdx = outcomeIndex === 0 ? 1 : 0;
  const otherPool = pools[otherIdx] ?? 0n;
  // Can't pull more than the opposing pool (with room for fees).
  let hi = (otherPool * 9_800n) / 10_000n;
  if (hi <= 0n) return 0n;
  let lo = 0n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    let tokensIn: bigint;
    try {
      tokensIn = calcSellAmount(mid, outcomeIndex, pools, BigInt(TRADE_FEE_TOTAL_BPS));
    } catch {
      hi = mid - 1n;
      continue;
    }
    if (tokensIn <= maxTokensIn) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

export function applySlippageMinOut(expectedOut: bigint, slippageBps: number): bigint {
  const slipBps = Math.min(5000, Math.max(1, slippageBps));
  return (expectedOut * BigInt(10_000 - slipBps)) / 10_000n;
}

export function applySlippageMaxIn(expectedIn: bigint, slippageBps: number): bigint {
  const slipBps = Math.min(5000, Math.max(1, slippageBps));
  return (expectedIn * BigInt(10_000 + slipBps)) / 10_000n;
}

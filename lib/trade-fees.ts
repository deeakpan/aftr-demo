/** Per-trade fee: 1.0% split 25/25/25/25 (creator / platform dev / distribution / treasury). */
export const CREATOR_FEE_BPS = 25;
export const PLATFORM_DEV_FEE_BPS = 25;
export const DISTRIBUTION_FEE_BPS = 25;
export const TREASURY_FEE_BPS = 25;
export const TRADE_FEE_TOTAL_BPS =
  CREATOR_FEE_BPS + PLATFORM_DEV_FEE_BPS + DISTRIBUTION_FEE_BPS + TREASURY_FEE_BPS;

export function tradeFeesFromAmount(amountWei: bigint): {
  creatorFee: bigint;
  platformDevFee: bigint;
  distributionFee: bigint;
  treasuryFee: bigint;
  netAmount: bigint;
} {
  const totalFee = (amountWei * BigInt(TRADE_FEE_TOTAL_BPS)) / BigInt(10_000);
  const share = totalFee / 4n;
  return {
    creatorFee: totalFee - share * 3n,
    platformDevFee: share,
    distributionFee: share,
    treasuryFee: share,
    netAmount: amountWei - totalFee,
  };
}

/** Per-trade fee split: 0.6% creator + 0.4% protocol = 1.0% total. */
export const CREATOR_FEE_BPS = 60;
export const PROTOCOL_FEE_BPS = 40;
export const TRADE_FEE_TOTAL_BPS = CREATOR_FEE_BPS + PROTOCOL_FEE_BPS;

export function tradeFeesFromAmount(amountWei: bigint): {
  creatorFee: bigint;
  protocolFee: bigint;
  netAmount: bigint;
} {
  const creatorFee = (amountWei * BigInt(CREATOR_FEE_BPS)) / BigInt(10_000);
  const protocolFee = (amountWei * BigInt(PROTOCOL_FEE_BPS)) / BigInt(10_000);
  return { creatorFee, protocolFee, netAmount: amountWei - creatorFee - protocolFee };
}

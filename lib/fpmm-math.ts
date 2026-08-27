/** Client-side Gnosis/Zedkr FPMM math (matches contracts/fpmm/ZedkrFpmmMath.sol). */

const ONE = 10n ** 18n;

function ceildiv(x: bigint, y: bigint): bigint {
  if (y === 0n) throw new Error("Division by zero");
  if (x > 0n) return (x - 1n) / y + 1n;
  return x / y;
}

/**
 * Outcome tokens received when spending `investmentAmount` (already net of protocol fees
 * when calling the market's `buy`, which passes feeBps=0 into this helper).
 */
export function calcBuyAmount(
  investmentAmount: bigint,
  outcomeIndex: number,
  poolBalances: readonly bigint[],
  feeBps = 0n,
): bigint {
  if (outcomeIndex < 0 || outcomeIndex >= poolBalances.length) {
    throw new Error("Invalid outcome");
  }
  if (poolBalances.length < 2) throw new Error("Pool size");
  if (investmentAmount <= 0n) return 0n;

  const investmentAmountMinusFees =
    investmentAmount - (investmentAmount * feeBps) / 10_000n;
  const buyTokenPoolBalance = poolBalances[outcomeIndex]!;
  let endingOutcomeBalance = buyTokenPoolBalance * ONE;

  for (let i = 0; i < poolBalances.length; i += 1) {
    if (i === outcomeIndex) continue;
    const poolBalance = poolBalances[i]!;
    endingOutcomeBalance =
      (endingOutcomeBalance * poolBalance) /
      ceildiv(poolBalance + investmentAmountMinusFees, 1n);
  }

  if (endingOutcomeBalance <= 0n) throw new Error("Zero ending balance");
  return buyTokenPoolBalance + investmentAmountMinusFees - ceildiv(endingOutcomeBalance, ONE);
}

/**
 * Outcome tokens to burn to receive `returnAmount` collateral (before fee gross-up on sell).
 */
export function calcSellAmount(
  returnAmount: bigint,
  outcomeIndex: number,
  poolBalances: readonly bigint[],
  feeBps: bigint,
): bigint {
  if (outcomeIndex < 0 || outcomeIndex >= poolBalances.length) {
    throw new Error("Invalid outcome");
  }
  if (poolBalances.length < 2) throw new Error("Pool size");
  if (feeBps >= 10_000n) throw new Error("Fee range");
  if (returnAmount <= 0n) return 0n;

  const returnAmountPlusFees = (returnAmount * 10_000n) / (10_000n - feeBps);
  const sellTokenPoolBalance = poolBalances[outcomeIndex]!;
  let endingOutcomeBalance = sellTokenPoolBalance * ONE;

  for (let i = 0; i < poolBalances.length; i += 1) {
    if (i === outcomeIndex) continue;
    const poolBalance = poolBalances[i]!;
    endingOutcomeBalance =
      (endingOutcomeBalance * poolBalance) /
      ceildiv(poolBalance - returnAmountPlusFees, 1n);
  }

  if (endingOutcomeBalance <= 0n) throw new Error("Zero ending balance");
  return returnAmountPlusFees + ceildiv(endingOutcomeBalance, ONE) - sellTokenPoolBalance;
}

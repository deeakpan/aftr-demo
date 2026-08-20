import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/** Uniswap v4 TickMath bounds (full-range position). */
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;
const Q96 = 1n << 96n;
const Q192 = 1n << 192n;

export function ponsPoolId(opts: {
  token: Address;
  pairToken: Address;
  poolFee: number;
  tickSpacing: number;
  hooks: Address;
}): Hex {
  const token = opts.token.toLowerCase();
  const pair = opts.pairToken.toLowerCase();
  const [currency0, currency1] = pair < token ? [opts.pairToken, opts.token] : [opts.token, opts.pairToken];
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [currency0, currency1, opts.poolFee, opts.tickSpacing, opts.hooks],
    ),
  );
}

export function tokenIsCurrency1(token: Address, pairToken: Address): boolean {
  return pairToken.toLowerCase() < token.toLowerCase();
}

/** Amount of currency0 / currency1 in a full-range v4 position at the current price. */
export function fullRangeAmounts(sqrtPriceX96: bigint, liquidity: bigint): { amount0: bigint; amount1: bigint } {
  if (liquidity === 0n || sqrtPriceX96 === 0n) return { amount0: 0n, amount1: 0n };
  const p = sqrtPriceX96 < MIN_SQRT_RATIO ? MIN_SQRT_RATIO : sqrtPriceX96 > MAX_SQRT_RATIO ? MAX_SQRT_RATIO : sqrtPriceX96;
  return {
    amount0: getAmount0ForLiquidity(p, MAX_SQRT_RATIO, liquidity),
    amount1: getAmount1ForLiquidity(MIN_SQRT_RATIO, p, liquidity),
  };
}

function getAmount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) {
    const t = sqrtA;
    sqrtA = sqrtB;
    sqrtB = t;
  }
  if (sqrtA === 0n) return 0n;
  return ((liquidity << 96n) * (sqrtB - sqrtA)) / sqrtB / sqrtA;
}

function getAmount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) {
    const t = sqrtA;
    sqrtA = sqrtB;
    sqrtB = t;
  }
  return (liquidity * (sqrtB - sqrtA)) / Q96;
}

/** Whole quote tokens per 1 whole launch token, from v4 sqrtPrice. */
export function tokenPriceInQuote(
  sqrtPriceX96: bigint,
  tokenIsC1: boolean,
  quoteDecimals: number,
  tokenDecimals: number,
): number | null {
  if (sqrtPriceX96 <= 0n) return null;
  const p2 = sqrtPriceX96 * sqrtPriceX96;
  let raw: bigint;
  if (tokenIsC1) {
    raw = (10n ** BigInt(tokenDecimals) * Q192) / p2;
    const whole = Number(raw) / 10 ** quoteDecimals;
    return Number.isFinite(whole) && whole > 0 ? whole : null;
  }
  raw = (10n ** BigInt(tokenDecimals) * p2) / Q192;
  const whole = Number(raw) / 10 ** quoteDecimals;
  return Number.isFinite(whole) && whole > 0 ? whole : null;
}

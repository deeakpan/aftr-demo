import { formatUnits } from "viem";

/**
 * Subgraph trader totals (`totalDeposited` / `totalRedeemed`) are raw collateral
 * units. Mondalore USDC is 6 decimals — formatting as 18 makes every PnL look like $0.00.
 * Native MON (18) markets are rare; primary display collateral is USDC.
 */
export const SUBGRAPH_COLLATERAL_DECIMALS = 6;

export function formatSubgraphUsd(value: bigint): string {
  const n = Number(formatUnits(value, SUBGRAPH_COLLATERAL_DECIMALS));
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatSubgraphPnlUsd(pnl: bigint): string {
  const abs = pnl < BigInt(0) ? -pnl : pnl;
  return `${pnl < BigInt(0) ? "-" : ""}${formatSubgraphUsd(abs)}`;
}

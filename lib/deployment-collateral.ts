import deployment from "@/lib/deployment";
import { zeroAddress, type Address } from "viem";

const contracts = deployment.contracts as Record<string, string | undefined>;

/** Match USDC-like UI (dollar-ish labels) — Circle USDC + minted MondaloreUSDC.sol. */
export function isUsdStyledCollateralTicker(ticker: string): boolean {
  return ticker === "USDC" || ticker === "Mondalore USDC";
}

export function collateralTickerFromDeployment(address: Address): string {
  const lower = address.toLowerCase();
  if (lower === zeroAddress.toLowerCase()) return "MON";
  const aftrUsdc = contracts.MondaloreUSDC?.toLowerCase();
  const circle = (
    deployment as unknown as {
      external?: { umaBondCurrencyCircleUSDC?: string };
    }
  ).external?.umaBondCurrencyCircleUSDC?.toLowerCase();
  if (circle && lower === circle) return "USDC";
  if (aftrUsdc && lower === aftrUsdc) return "Mondalore USDC";
  return "TOKEN";
}

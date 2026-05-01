import deployment from "@/deployments/baseSepolia-84532.json";
import { zeroAddress, type Address } from "viem";

const contracts = deployment.contracts as Record<string, string | undefined>;

/** Match USDC-like UI (dollar-ish labels) — Circle USDC + minted AFTRUSDC.sol. */
export function isUsdStyledCollateralTicker(ticker: string): boolean {
  return ticker === "USDC" || ticker === "AFTR USDC";
}

export function collateralTickerFromDeployment(address: Address): string {
  const lower = address.toLowerCase();
  if (lower === zeroAddress.toLowerCase()) return "ETH";
  const usdead = contracts.USDeAD?.toLowerCase();
  const aftrUsdc = contracts.AFTRUSDC?.toLowerCase();
  const circle = (
    deployment as unknown as {
      external?: { umaBondCurrencyCircleUSDC?: string };
    }
  ).external?.umaBondCurrencyCircleUSDC?.toLowerCase();
  if (usdead && lower === usdead) return "USDeAD";
  if (circle && lower === circle) return "USDC";
  if (aftrUsdc && lower === aftrUsdc) return "AFTR USDC";
  return "TOKEN";
}

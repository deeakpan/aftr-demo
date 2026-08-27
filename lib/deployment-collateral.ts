import deployment from "@/lib/deployment";
import { zeroAddress, type Address } from "viem";
import { tradingUsdgAddress } from "@/lib/usdg";

const contracts = deployment.contracts as Record<string, string | undefined>;

/** Match USDC-like UI (dollar-ish labels) — Circle USDC + minted MondaloreUSDC.sol. */
export function isUsdStyledCollateralTicker(ticker: string): boolean {
  return ticker === "USDC" || ticker === "Mondalore USDC" || ticker === "USDG";
}

export function collateralTickerFromDeployment(address: Address): string {
  const lower = address.toLowerCase();
  if (lower === zeroAddress.toLowerCase()) return "ETH";
  const aftrUsdc = contracts.MondaloreUSDC?.toLowerCase();
  const tradingUsdg = tradingUsdgAddress()?.toLowerCase();
  const usdg = contracts.USDG?.toLowerCase();
  const circle = (
    deployment as unknown as {
      external?: { umaBondCurrencyCircleUSDC?: string; pons?: { usdg?: string } };
    }
  ).external?.umaBondCurrencyCircleUSDC?.toLowerCase();
  const usdgExternal = (
    deployment as unknown as { external?: { pons?: { usdg?: string } } }
  ).external?.pons?.usdg?.toLowerCase();
  if (tradingUsdg && lower === tradingUsdg) return "USDG";
  if (usdg && lower === usdg) return "USDG";
  if (usdgExternal && lower === usdgExternal) return "USDG";
  if (circle && lower === circle) return "USDC";
  if (aftrUsdc && lower === aftrUsdc) return "USDC";
  return "TOKEN";
}

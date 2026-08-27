import deployment, { deploymentExternal, isDeployedAddress } from "@/lib/deployment";
import type { Address } from "viem";

/**
 * When true, app trading collateral / profile balance use deployed mock USDG
 * (`contracts.USDG`). When false, use canonical Robinhood USDG (`external.pons.usdg`).
 *
 * Set `NEXT_PUBLIC_USE_MOCK_USDG=1` (client + server).
 */
export function useMockUsdg(): boolean {
  const raw = (process.env.NEXT_PUBLIC_USE_MOCK_USDG ?? process.env.USE_MOCK_USDG ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Active USDG for UI balances / default create collateral. */
export function tradingUsdgAddress(): Address | null {
  const contracts = deployment.contracts as Record<string, string | undefined>;
  const mock = contracts.USDG?.trim();
  const real = deploymentExternal().pons?.usdg?.trim();
  const pick = useMockUsdg() ? mock : real ?? mock;
  if (!isDeployedAddress(pick)) return null;
  return pick as Address;
}

export function tradingUsdgLabel(): string {
  return useMockUsdg() ? "USDG" : "USDG";
}

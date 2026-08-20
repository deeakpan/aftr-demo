import monadDeployment from "@/deployments/monadTestnet-10143.json";
import robinhoodDeployment from "@/deployments/robinhoodMainnet-4663.json";
import { DEPLOYMENT_CHAIN_ID } from "@/lib/chain";

const DEPLOYMENTS = {
  10143: monadDeployment,
  4663: robinhoodDeployment,
} as const;

const deploymentRecord =
  DEPLOYMENTS[DEPLOYMENT_CHAIN_ID as keyof typeof DEPLOYMENTS] ?? robinhoodDeployment;

function isDeployed(addr: string | undefined | null): addr is `0x${string}` {
  if (!addr) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(addr) && !/^0x0+$/i.test(addr);
}

/** Primary market factory — prefers FPMM when deployed. */
export function activeMarketFactoryAddress(): `0x${string}` | null {
  const contracts = deploymentRecord.contracts as Record<string, string | undefined>;
  const fpmm = contracts.ZedkrFpmmMarketFactory;
  if (isDeployed(fpmm)) return fpmm as `0x${string}`;
  const pari = contracts.MondaloreParimutuelMarketFactory;
  if (isDeployed(pari)) return pari as `0x${string}`;
  return null;
}

export function fpmmFactoryAddress(): `0x${string}` | null {
  const addr = (deploymentRecord.contracts as Record<string, string | undefined>).ZedkrFpmmMarketFactory;
  return isDeployed(addr) ? (addr as `0x${string}`) : null;
}

export function parimutuelFactoryAddress(): `0x${string}` | null {
  const addr = (deploymentRecord.contracts as Record<string, string | undefined>).MondaloreParimutuelMarketFactory;
  return isDeployed(addr) ? (addr as `0x${string}`) : null;
}

export function usesFpmmMechanism(): boolean {
  return fpmmFactoryAddress() != null && activeMarketFactoryAddress() === fpmmFactoryAddress();
}

export function collateralRegistryAddress(): `0x${string}` | null {
  const addr = (deploymentRecord.contracts as Record<string, string | undefined>).ZedkrCollateralRegistry;
  return isDeployed(addr) ? (addr as `0x${string}`) : null;
}

export function deploymentContractsRecord() {
  return deploymentRecord.contracts as Record<string, string | undefined>;
}

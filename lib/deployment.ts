import monadDeployment from "@/deployments/monadTestnet-10143.json";
import robinhoodDeployment from "@/deployments/robinhoodMainnet-4663.json";
import { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL } from "@/lib/chain";
import {
  activeMarketFactoryAddress,
  fpmmFactoryAddress,
  usesFpmmMechanism,
} from "@/lib/market-factory";

const DEPLOYMENTS = {
  10143: monadDeployment,
  4663: robinhoodDeployment,
} as const;

const deployment =
  DEPLOYMENTS[DEPLOYMENT_CHAIN_ID as keyof typeof DEPLOYMENTS] ?? robinhoodDeployment;

export default deployment;
export { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL };

export function wrongNetworkMessage(chainId: number = DEPLOYMENT_CHAIN_ID): string {
  return `Switch to ${DEPLOYMENT_NETWORK_LABEL} (${chainId}).`;
}

/** True when the address is a real contract, not the undeployed placeholder. */
export function isDeployedAddress(addr: string | undefined | null): addr is `0x${string}` {
  if (!addr) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(addr) && !/^0x0+$/i.test(addr);
}

export function marketFactoryAddress(): `0x${string}` | null {
  return activeMarketFactoryAddress();
}

export { fpmmFactoryAddress, usesFpmmMechanism };

export function undeployedStackMessage(): string {
  return `Zedkr Market is not deployed on ${DEPLOYMENT_NETWORK_LABEL} yet. Run: npx hardhat run scripts/deploy-aftr-full-stack.cjs --network robinhoodMainnet`;
}

export type DeploymentExternal = {
  chainlinkFeeds?: {
    label: string;
    asset: string;
    logo?: string;
    address: string;
    decimals?: number;
    tokenAddress?: string;
  }[];
  priceFeedAssets?: { label: string; asset: string; logo?: string }[];
  pons?: {
    v2LaunchFactory: string;
    v1LaunchFactory?: string;
    weth?: string;
    usdg?: string;
  };
};

export function deploymentExternal(): DeploymentExternal {
  return (deployment.external ?? {}) as DeploymentExternal;
}

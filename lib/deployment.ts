import deployment from "@/deployments/monadTestnet-10143.json";
import { DEPLOYMENT_NETWORK_LABEL } from "@/lib/chain";

export default deployment;
export const DEPLOYMENT_CHAIN_ID = deployment.chainId as number;
export { DEPLOYMENT_NETWORK_LABEL };

export function wrongNetworkMessage(chainId: number = DEPLOYMENT_CHAIN_ID): string {
  return `Switch to ${DEPLOYMENT_NETWORK_LABEL} (${chainId}).`;
}

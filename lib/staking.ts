import deployment from "@/lib/deployment";
import { MON_COINGECKO_LOGO, USDC_COINGECKO_LOGO } from "@/lib/brand-assets";
import { parseAbi, zeroAddress, type Address } from "viem";

type DeploymentContracts = {
  MondaloreFeeVault?: string;
  MondaloreToken?: string;
  MondaloreUSDC?: string;
  MockWETH?: string;
};

const contracts = (deployment as { contracts?: DeploymentContracts }).contracts ?? {};
const vaultMeta = (deployment as { vault?: { stakeToken?: string; lockDuration?: string; epochDuration?: string; rewardTokens?: string[] } }).vault ?? {};

export const VAULT_ADDRESS = contracts.MondaloreFeeVault as Address | undefined;
export const STAKE_TOKEN_ADDRESS = (vaultMeta.stakeToken ?? contracts.MondaloreToken) as Address | undefined;
export const VAULT_LOCK_DURATION_SEC = Number(vaultMeta.lockDuration ?? "604800");
export const VAULT_EPOCH_DURATION_SEC = Number(vaultMeta.epochDuration ?? "604800");

export const VAULT_ABI = parseAbi([
  "function stake(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claimRewards()",
  "function claimReward(address token)",
  "function totalStaked() view returns (uint256)",
  "function currentEpoch() view returns (uint256)",
  "function lockDuration() view returns (uint256)",
  "function stakeToken() view returns (address)",
  "function receiptToken() view returns (address)",
  "function earnedAll(address user) view returns (address[] tokens, uint256[] amounts)",
  "function withdrawStatus(address user) view returns (uint256 withdrawable, uint256 locked, uint256 nextUnlockTimestamp)",
  "function withdrawableBalance(address user) view returns (uint256)",
  "function lockedBalance(address user) view returns (uint256)",
  "function rewardTokens(uint256 index) view returns (address)",
]);

export const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export function rewardTokenLabel(token: Address): { symbol: string; logo?: string; decimals: number } {
  const lower = token.toLowerCase();
  if (lower === zeroAddress) return { symbol: "MON", logo: MON_COINGECKO_LOGO, decimals: 18 };
  if (contracts.MondaloreUSDC && lower === contracts.MondaloreUSDC.toLowerCase()) {
    return { symbol: "USDC", logo: USDC_COINGECKO_LOGO, decimals: 6 };
  }
  if (contracts.MockWETH && lower === contracts.MockWETH.toLowerCase()) {
    return { symbol: "WETH", logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png", decimals: 18 };
  }
  if (contracts.MondaloreToken && lower === contracts.MondaloreToken.toLowerCase()) {
    return { symbol: "MONDO", logo: MON_COINGECKO_LOGO, decimals: 18 };
  }
  return { symbol: `${token.slice(0, 6)}…`, decimals: 18 };
}

export function listedRewardTokens(): Address[] {
  const raw = vaultMeta.rewardTokens ?? [];
  return raw.map((t) => t as Address);
}

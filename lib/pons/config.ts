import { deploymentExternal } from "@/lib/deployment";

/** Pons V2 launch factory on Robinhood Chain. */
export function ponsV2FactoryAddress(): `0x${string}` {
  const fromEnv = process.env.PONS_V2_FACTORY?.trim() || process.env.NEXT_PUBLIC_PONS_V2_FACTORY?.trim();
  if (fromEnv) return fromEnv as `0x${string}`;
  const ext = deploymentExternal().pons;
  return (ext?.v2LaunchFactory ?? "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e") as `0x${string}`;
}

export function ponsAppBaseUrl(): string {
  return "https://ponsfamily.com";
}

export function ponsTokenPageUrl(tokenAddress: string): string {
  return `${ponsAppBaseUrl()}/launchpad/${tokenAddress.toLowerCase()}`;
}

/** Protocol infra — not valid launch tokens. */
const PONS_INFRA_LABELS: Record<string, string> = {
  "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e": "Pons V2 factory",
  "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb": "Pons V1 factory",
  "0xe33e9e479df8802cb0866d5d05258bec4cf62948": "Pons launch router",
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73": "WETH",
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168": "USDG",
  "0x8366a39cc670b4001a1121b8f6a443a643e40951": "Uniswap V4 PoolManager",
  "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044": "Pons meme hook",
};

export function ponsMemeHookAddress(): `0x${string}` {
  const fromEnv = process.env.PONS_MEME_HOOK?.trim() || process.env.NEXT_PUBLIC_PONS_MEME_HOOK?.trim();
  if (fromEnv) return fromEnv as `0x${string}`;
  return "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044";
}

export function uniswapV4StateViewAddress(): `0x${string}` {
  return "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b";
}

export function knownPonsInfraLabel(address: string): string | null {
  return PONS_INFRA_LABELS[address.toLowerCase()] ?? null;
}

/** Pons V2 launch phases — https://docs.ponsfamily.com/v2 */
export const PONS_PHASE = {
  NOT_GRADUATED: 0,
  SWEPT: 1,
  POOL_CREATED: 2,
  RESCUED: 3,
} as const;

/** Listable markets: graduated Uniswap v4 (phase 2). */
export const PONS_DEX_PHASE = PONS_PHASE.POOL_CREATED;

/** Quote-side DEX liquidity must exceed this (ETH, or ETH-equivalent for USDG pairs). */
export const PONS_MIN_DEX_LIQUIDITY_ETH = 5;

/** @deprecated Bonded-curve markets are not listed; use PONS_DEX_PHASE. */
export const PONS_BONDED_PHASE = PONS_PHASE.NOT_GRADUATED;

export function ponsPhaseLabel(phase: number): string {
  switch (phase) {
    case PONS_PHASE.NOT_GRADUATED:
      return "bonding curve";
    case PONS_PHASE.SWEPT:
      return "graduating (swept)";
    case PONS_PHASE.POOL_CREATED:
      return "Uniswap v4";
    case PONS_PHASE.RESCUED:
      return "rescued";
    default:
      return `phase ${phase}`;
  }
}

/** Display URL for token logos from on-chain `getTokenInfo().tokenLogo`. */
export function ponsTokenImageUrl(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (/nad\.fun|nads\.fun/i.test(trimmed)) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("ipfs://")) {
    const cid = trimmed.slice(7).trim();
    if (!cid) return "";
    return `https://www.ponsfamily.com/api/ipfs/content/${cid}?variant=card`;
  }
  return trimmed;
}

import type { NadMarketConfig } from "@/lib/nad/types";
import type { PonsMarketConfig } from "@/lib/pons/types";
import { ponsMarketForCardPreview } from "@/lib/pons/adapt-display";
import { parseLaunchpadMarketFromMetadata } from "@/lib/pons/parse-config";

function isPonsConfig(
  cfg: PonsMarketConfig | NadMarketConfig,
): cfg is PonsMarketConfig {
  return "launchpad" in cfg && cfg.launchpad === "pons";
}

/** Pons or legacy Nad block from IPFS metadata — for listable image checks. */
export function launchpadMarketFromMetadata(
  md: Record<string, unknown> | null | undefined,
): PonsMarketConfig | NadMarketConfig | null {
  return parseLaunchpadMarketFromMetadata(md);
}

/** Map launchpad metadata to Nad card shape (Pons → adapted; Nad → as-is). */
export function launchpadMarketForDisplay(
  md: Record<string, unknown> | null | undefined,
): NadMarketConfig | undefined {
  const parsed = launchpadMarketFromMetadata(md);
  if (!parsed) {
    const legacy = md?.nadMarket;
    return legacy && typeof legacy === "object" ? (legacy as NadMarketConfig) : undefined;
  }
  if (isPonsConfig(parsed)) return ponsMarketForCardPreview(parsed);
  return parsed;
}

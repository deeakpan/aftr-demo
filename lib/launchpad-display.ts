import type { UiMarketKind } from "@/lib/markets/market-kind";
import { marketKindFromChain } from "@/lib/markets/market-kind";
import type { NadMarketConfig } from "@/lib/nad/types";
import type { PonsMarketConfig } from "@/lib/pons/types";
import { ponsMarketForCardPreview } from "@/lib/pons/adapt-display";
import { parseLaunchpadMarketFromMetadata } from "@/lib/pons/parse-config";
import { tokenMarketForCardPreview } from "@/lib/token-market/adapt-display";
import { parseTokenMarketFromMetadata } from "@/lib/token-market/parse-config";

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

/** UI label for chain kind 2 — token-link → "Token", legacy Pons / Nad otherwise. */
export function uiMarketKindForDisplay(
  chainKind: number,
  md?: Record<string, unknown> | null,
): UiMarketKind {
  const base = marketKindFromChain(chainKind);
  if (base !== "Token" && base !== "Nad") return base;
  if (parseTokenMarketFromMetadata(md)) return "Token";
  const raw = launchpadMarketFromMetadata(md);
  if (raw && "launchpad" in raw && raw.launchpad === "pons") return "Pons";
  if (raw) return "Nad";
  return "Token";
}

/** Map launchpad metadata to Nad card shape (Pons → adapted; Nad → as-is). */
export function launchpadMarketForDisplay(
  md: Record<string, unknown> | null | undefined,
): NadMarketConfig | undefined {
  const token = parseTokenMarketFromMetadata(md as Record<string, unknown> | null);
  if (token) return tokenMarketForCardPreview(token);
  const parsed = launchpadMarketFromMetadata(md);
  if (!parsed) {
    const legacy = md?.nadMarket;
    return legacy && typeof legacy === "object" ? (legacy as NadMarketConfig) : undefined;
  }
  if (isPonsConfig(parsed)) return ponsMarketForCardPreview(parsed);
  return parsed;
}

import { fetchIpfsMetadataNoCache } from "@/lib/ipfs-metadata";
import { evaluateNadOutcome } from "@/lib/nad/evaluate-outcome";
import { parseNadMarketFromMetadata } from "@/lib/nad/parse-config";
import { fetchNadResolutionSnapshots } from "@/lib/nad/resolution-snapshot";
import { evaluatePonsOutcome } from "@/lib/pons/evaluate-outcome";
import { parsePonsMarketFromMetadata } from "@/lib/pons/parse-config";
import { fetchPonsResolutionSnapshots } from "@/lib/pons/resolution-snapshot";
import { evaluatePrismOutcome } from "@/lib/prism/evaluate-outcome";
import { parsePrismMarketFromMetadata } from "@/lib/prism/parse-config";
import { fetchPrismResolutionSnapshots } from "@/lib/prism/resolution-snapshot";
import { evaluateTokenOutcome } from "@/lib/token-market/evaluate-outcome";
import { parseTokenMarketFromMetadata } from "@/lib/token-market/parse-config";
import { fetchTokenResolutionSnapshots } from "@/lib/token-market/resolution-snapshot";

export type LaunchpadEvaluation = {
  launchpad: "token" | "pons" | "nad" | "prism";
  outcomeIndex: number;
  outcomeLabel: string;
  reasoning: string;
};

export async function evaluateLaunchpadMarketFromUri(metadataURI: string): Promise<LaunchpadEvaluation> {
  const md = await fetchIpfsMetadataNoCache(metadataURI, { attempts: 3, timeoutMs: 10_000 });
  if (!md) throw new Error(`Could not load metadata: ${metadataURI}`);

  const prismMarket = parsePrismMarketFromMetadata(md as Record<string, unknown>);
  if (prismMarket) {
    const snapshots = await fetchPrismResolutionSnapshots(prismMarket);
    const evaluation = evaluatePrismOutcome(prismMarket, snapshots);
    return {
      launchpad: "prism",
      outcomeIndex: evaluation.outcomeIndex,
      outcomeLabel: evaluation.outcomeLabel,
      reasoning: evaluation.reasoning,
    };
  }

  const tokenMarket = parseTokenMarketFromMetadata(md as Record<string, unknown>);
  if (tokenMarket) {
    const snapshots = await fetchTokenResolutionSnapshots(tokenMarket);
    const evaluation = evaluateTokenOutcome(tokenMarket, snapshots);
    return {
      launchpad: "token",
      outcomeIndex: evaluation.outcomeIndex,
      outcomeLabel: evaluation.outcomeLabel,
      reasoning: evaluation.reasoning,
    };
  }

  const ponsMarket = parsePonsMarketFromMetadata(md);
  if (ponsMarket) {
    const snapshots = await fetchPonsResolutionSnapshots(ponsMarket);
    const evaluation = evaluatePonsOutcome(ponsMarket, snapshots);
    return {
      launchpad: "pons",
      outcomeIndex: evaluation.outcomeIndex,
      outcomeLabel: evaluation.outcomeLabel,
      reasoning: evaluation.evidence.reasoning,
    };
  }

  const nadMarket = parseNadMarketFromMetadata(md);
  if (nadMarket) {
    const snapshots = await fetchNadResolutionSnapshots(nadMarket);
    const evaluation = evaluateNadOutcome(nadMarket, snapshots);
    return {
      launchpad: "nad",
      outcomeIndex: evaluation.outcomeIndex,
      outcomeLabel: evaluation.outcomeLabel,
      reasoning: evaluation.evidence.reasoning,
    };
  }

  throw new Error("Metadata has no valid prismMarket, tokenMarket, ponsMarket, or nadMarket block");
}

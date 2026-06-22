import { fetchIpfsMetadata } from "@/lib/ipfs-metadata";
import type { NadMarketConfig } from "./types";
import { buildDuplicateKey } from "./metadata";

export function parseNadMarketFromMetadata(
  md: Record<string, unknown> | null | undefined,
): NadMarketConfig | null {
  const raw = md?.nadMarket;
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as NadMarketConfig;
  if (cfg.version !== 1 || !cfg.questionType || !Array.isArray(cfg.tokens)) return null;
  return cfg;
}

export function isNadMarketMetadata(md: Record<string, unknown> | null | undefined): boolean {
  return parseNadMarketFromMetadata(md) !== null;
}

export type DuplicateCheckInput = {
  questionType: string;
  tokenAddresses: string[];
  resolveAfterUnix: number;
  thresholdUsd?: string;
};

export type DuplicateMarketHit = {
  marketAddress: string;
  title: string;
  resolveAfterUnix: number;
};

/** Same question + same token(s) + same resolveAfter = duplicate. Different resolve window = allowed. */
export function matchesDuplicateKey(
  existing: NadMarketConfig,
  input: DuplicateCheckInput,
): boolean {
  const key = buildDuplicateKey({
    questionType: input.questionType as NadMarketConfig["questionType"],
    tokenAddresses: input.tokenAddresses,
    resolveAfterUnix: input.resolveAfterUnix,
    thresholdUsd: input.thresholdUsd,
  });
  return existing.duplicateKey === key;
}

export async function findDuplicateNadMarkets(
  input: DuplicateCheckInput,
  marketAddresses: { address: string; metadataUri: string; state: number }[],
): Promise<DuplicateMarketHit[]> {
  const key = buildDuplicateKey({
    questionType: input.questionType as NadMarketConfig["questionType"],
    tokenAddresses: input.tokenAddresses,
    resolveAfterUnix: input.resolveAfterUnix,
    thresholdUsd: input.thresholdUsd,
  });

  const hits: DuplicateMarketHit[] = [];

  await Promise.all(
    marketAddresses
      .filter((m) => m.state === 0)
      .map(async (m) => {
        try {
          const md = await fetchIpfsMetadata(m.metadataUri);
          const nad = parseNadMarketFromMetadata(md as Record<string, unknown>);
          if (!nad || nad.duplicateKey !== key) return;
          hits.push({
            marketAddress: m.address,
            title: (md?.title as string) ?? "Market",
            resolveAfterUnix: nad.resolveAfterUnix,
          });
        } catch {
          // skip unreadable metadata
        }
      }),
  );

  return hits;
}

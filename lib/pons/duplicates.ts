import { fetchIpfsMetadata } from "../ipfs-metadata";
import type { PonsMarketConfig } from "./types";
import { buildDuplicateKey } from "./metadata";
import { parsePonsMarketFromMetadata } from "./parse-config";

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

export async function findDuplicatePonsMarkets(
  input: DuplicateCheckInput,
  marketAddresses: { address: string; metadataUri: string; state: number }[],
): Promise<DuplicateMarketHit[]> {
  const key = buildDuplicateKey({
    questionType: input.questionType as PonsMarketConfig["questionType"],
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
          const pons = parsePonsMarketFromMetadata(md as Record<string, unknown>);
          if (!pons || pons.duplicateKey !== key) return;
          hits.push({
            marketAddress: m.address,
            title: (md?.title as string) ?? "Market",
            resolveAfterUnix: pons.resolveAfterUnix,
          });
        } catch {
          // skip unreadable metadata
        }
      }),
  );

  return hits;
}

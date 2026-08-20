import type { PonsQuestionType, PonsMarketConfig, PonsTokenRef } from "./types";
import { getPonsQuestionDef } from "./question-types";
import { DEPLOYMENT_CHAIN_ID } from "@/lib/chain";

export function buildDuplicateKey(opts: {
  questionType: PonsQuestionType;
  tokenAddresses: string[];
  resolveAfterUnix: number;
  thresholdUsd?: string;
}): string {
  const sorted = [...opts.tokenAddresses].map((a) => a.toLowerCase()).sort();
  const extra =
    opts.thresholdUsd && (opts.questionType === "mcap_usd_above" || opts.questionType === "price_usd_above")
      ? `:t${opts.thresholdUsd}`
      : "";
  return `pons:${opts.questionType}:${sorted.join(",")}:${opts.resolveAfterUnix}${extra}`;
}

export function buildPonsMarketConfig(opts: {
  questionType: PonsQuestionType;
  tokens: PonsTokenRef[];
  resolveAfterUnix: number;
  stakeEndUnix: number;
  thresholdUsd?: string;
}): PonsMarketConfig {
  const def = getPonsQuestionDef(opts.questionType);
  const duplicateKey = buildDuplicateKey({
    questionType: opts.questionType,
    tokenAddresses: opts.tokens.map((t) => t.address),
    resolveAfterUnix: opts.resolveAfterUnix,
    thresholdUsd: opts.thresholdUsd,
  });

  return {
    version: 1,
    launchpad: "pons",
    questionType: opts.questionType,
    mode: def.mode,
    tokens: opts.tokens,
    params: {
      ...(opts.thresholdUsd ? { thresholdUsd: opts.thresholdUsd } : {}),
    },
    chainId: DEPLOYMENT_CHAIN_ID,
    resolveAfterUnix: opts.resolveAfterUnix,
    stakeEndUnix: opts.stakeEndUnix,
    cardBackgroundSeed: opts.tokens.map((t) => t.address).sort().join("-"),
    duplicateKey,
  };
}

export function buildPonsTitle(
  questionType: PonsQuestionType,
  tokens: PonsTokenRef[],
  params: { thresholdUsd?: string },
  resolveLabel: string,
): string {
  const sym = tokens[0]?.symbol?.toUpperCase() ?? "TOKEN";
  switch (questionType) {
    case "mcap_usd_above":
      return `Will ${sym} mcap exceed $${Number(params.thresholdUsd ?? 0).toLocaleString()} by ${resolveLabel}?`;
    case "price_usd_above":
      return `Will ${sym} price exceed $${params.thresholdUsd} by ${resolveLabel}?`;
    case "mcap_highest":
      return `Which token has the highest mcap at ${resolveLabel}? (${tokens.map((t) => t.symbol.toUpperCase()).join(" vs ")})`;
    default:
      return `${sym} — ${resolveLabel}`;
  }
}

export function buildPonsOutcomes(questionType: PonsQuestionType, tokens: PonsTokenRef[]): string[] {
  const def = getPonsQuestionDef(questionType);
  if (def.mode === "binary") return ["Yes", "No"];
  return tokens.map((t) => t.symbol.toUpperCase());
}

export function buildPonsResolutionSources(tokens: PonsTokenRef[]): { label: string; url: string }[] {
  return tokens.map((t) => ({
    label: `${t.symbol} on Pons`,
    url: `https://ponsfamily.com/launchpad/${t.address}`,
  }));
}

export function cardBackgroundFromSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 42% 18%), hsl(${(hue + 40) % 360} 38% 12%))`;
}

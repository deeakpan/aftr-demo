import type { TokenMarketConfig, TokenPairRef, TokenQuestionType } from "./types";
import { getTokenQuestionDef } from "./question-types";

export function buildTokenDuplicateKey(opts: {
  questionType: TokenQuestionType;
  pairKeys: string[];
  resolveAfterUnix: number;
  thresholdUsd?: string;
}): string {
  const sorted = [...opts.pairKeys].map((a) => a.toLowerCase()).sort();
  const extra =
    opts.thresholdUsd && (opts.questionType === "mcap_usd_above" || opts.questionType === "price_usd_above")
      ? `:t${opts.thresholdUsd}`
      : "";
  return `token:${opts.questionType}:${sorted.join(",")}:${opts.resolveAfterUnix}${extra}`;
}

export function buildTokenMarketConfig(opts: {
  questionType: TokenQuestionType;
  pairs: TokenPairRef[];
  resolveAfterUnix: number;
  stakeEndUnix: number;
  thresholdUsd?: string;
}): TokenMarketConfig {
  const def = getTokenQuestionDef(opts.questionType);
  const pairKeys = opts.pairs.map((p) => `${p.chainSlug}:${p.pairAddress}`);
  return {
    version: 1,
    kind: "token-link",
    questionType: opts.questionType,
    mode: def.mode,
    pairs: opts.pairs,
    params: {
      ...(opts.thresholdUsd ? { thresholdUsd: opts.thresholdUsd } : {}),
    },
    resolveAfterUnix: opts.resolveAfterUnix,
    stakeEndUnix: opts.stakeEndUnix,
    cardBackgroundSeed: pairKeys.sort().join("-"),
    duplicateKey: buildTokenDuplicateKey({
      questionType: opts.questionType,
      pairKeys,
      resolveAfterUnix: opts.resolveAfterUnix,
      thresholdUsd: opts.thresholdUsd,
    }),
  };
}

export function buildTokenTitle(
  questionType: TokenQuestionType,
  pairs: TokenPairRef[],
  params: { thresholdUsd?: string },
  resolveLabel: string,
): string {
  const sym = pairs[0]?.symbol?.toUpperCase() ?? "TOKEN";
  switch (questionType) {
    case "mcap_usd_above":
      return `Will ${sym} mcap exceed $${Number(params.thresholdUsd ?? 0).toLocaleString()} by ${resolveLabel}?`;
    case "price_usd_above":
      return `Will ${sym} price exceed $${params.thresholdUsd} by ${resolveLabel}?`;
    case "mcap_highest":
      return `Which token has the highest mcap at ${resolveLabel}? (${pairs.map((t) => t.symbol.toUpperCase()).join(" vs ")})`;
    case "price_highest":
      return `Which token has the highest price at ${resolveLabel}? (${pairs.map((t) => t.symbol.toUpperCase()).join(" vs ")})`;
    default:
      return `${sym} — ${resolveLabel}`;
  }
}

export function buildTokenOutcomes(questionType: TokenQuestionType, pairs: TokenPairRef[]): string[] {
  const def = getTokenQuestionDef(questionType);
  if (def.mode === "binary") return ["Yes", "No"];
  return pairs.map((t) => t.symbol.toUpperCase());
}

export function buildTokenResolutionSources(pairs: TokenPairRef[]): { label: string; url: string }[] {
  return pairs.map((t) => ({
    label: `${t.symbol} on ${t.source === "geckoterminal" ? "GeckoTerminal" : "Dexscreener"}`,
    url: t.sourceUrl,
  }));
}

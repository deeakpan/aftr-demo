import { prismApiBaseUrl, prismListingUrl, prismVerifyUrl } from "./config";
import { getPrismQuestionDef } from "./question-types";
import type { PrismAssetRef, PrismMarketConfig, PrismQuestionType } from "./types";

export function buildPrismDuplicateKey(opts: {
  questionType: PrismQuestionType;
  slugs: string[];
  resolveAfterUnix: number;
  thresholdUsd?: string;
  thresholdApyPct?: string;
}): string {
  const sorted = [...opts.slugs].map((s) => s.toLowerCase()).sort();
  let extra = "";
  if (opts.thresholdUsd && (opts.questionType === "mcap_usd_above" || opts.questionType === "price_usd_above")) {
    extra += `:t${opts.thresholdUsd}`;
  }
  if (opts.thresholdApyPct && opts.questionType === "yield_apy_above") {
    extra += `:y${opts.thresholdApyPct}`;
  }
  return `prism:${opts.questionType}:${sorted.join(",")}:${opts.resolveAfterUnix}${extra}`;
}

export function buildPrismMarketConfig(opts: {
  questionType: PrismQuestionType;
  assets: PrismAssetRef[];
  resolveAfterUnix: number;
  stakeEndUnix: number;
  thresholdUsd?: string;
  thresholdApyPct?: string;
}): PrismMarketConfig {
  const def = getPrismQuestionDef(opts.questionType);
  const slugs = opts.assets.map((a) => a.slug);
  return {
    version: 1,
    launchpad: "prism",
    questionType: opts.questionType,
    mode: def.mode,
    assets: opts.assets,
    params: {
      ...(opts.thresholdUsd ? { thresholdUsd: opts.thresholdUsd } : {}),
      ...(opts.thresholdApyPct ? { thresholdApyPct: opts.thresholdApyPct } : {}),
    },
    apiBaseUrl: prismApiBaseUrl(),
    resolveAfterUnix: opts.resolveAfterUnix,
    stakeEndUnix: opts.stakeEndUnix,
    cardBackgroundSeed: slugs.slice().sort().join("-"),
    duplicateKey: buildPrismDuplicateKey({
      questionType: opts.questionType,
      slugs,
      resolveAfterUnix: opts.resolveAfterUnix,
      thresholdUsd: opts.thresholdUsd,
      thresholdApyPct: opts.thresholdApyPct,
    }),
  };
}

export function buildPrismTitle(
  questionType: PrismQuestionType,
  assets: PrismAssetRef[],
  params: { thresholdUsd?: string; thresholdApyPct?: string },
  resolveLabel: string,
): string {
  const sym = assets[0]?.symbol?.toUpperCase() ?? "RWA";
  const names = assets.map((a) => a.symbol.toUpperCase()).join(" vs ");
  switch (questionType) {
    case "price_usd_above":
      return `Will ${sym} price exceed $${params.thresholdUsd} by ${resolveLabel}?`;
    case "mcap_usd_above":
      return `Will ${sym} market cap exceed $${Number(params.thresholdUsd ?? 0).toLocaleString()} by ${resolveLabel}?`;
    case "yield_apy_above":
      return `Will ${sym} APY exceed ${params.thresholdApyPct}% by ${resolveLabel}?`;
    case "price_highest":
      return `Which RWA has the highest price at ${resolveLabel}? (${names})`;
    case "mcap_highest":
      return `Which RWA has the highest market cap at ${resolveLabel}? (${names})`;
    case "yield_highest":
      return `Which RWA has the highest APY at ${resolveLabel}? (${names})`;
    default:
      return `${sym} — ${resolveLabel}`;
  }
}

export function buildPrismOutcomes(questionType: PrismQuestionType, assets: PrismAssetRef[]): string[] {
  const def = getPrismQuestionDef(questionType);
  if (def.mode === "binary") return ["Yes", "No"];
  return assets.map((a) => a.symbol.toUpperCase());
}

export function buildPrismResolutionSources(assets: PrismAssetRef[]): { label: string; url: string }[] {
  const sources = assets.map((a) => ({
    label: `${a.symbol} on Prism`,
    url: prismListingUrl(a.slug),
  }));
  if (assets[0]) {
    sources.push({
      label: `Prism verify · ${assets[0].symbol}`,
      url: prismVerifyUrl(assets[0].symbol),
    });
  }
  return sources;
}

export function buildPrismDescription(assets: PrismAssetRef[], questionType: PrismQuestionType): string {
  const def = getPrismQuestionDef(questionType);
  const list = assets.map((a) => `${a.symbol} (${a.name})`).join(", ");
  return `Resolved from Prism Assets catalogue at resolve time. ${def.description} Assets: ${list}.`;
}

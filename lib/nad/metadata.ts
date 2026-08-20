import type { NadQuestionType, NadMarketConfig, NadResolutionEndpoint, NadTokenRef } from "./types";
import { nadApiBaseUrl } from "./config";
import { getQuestionDef } from "./question-types";

export function buildDuplicateKey(opts: {
  questionType: NadQuestionType;
  tokenAddresses: string[];
  resolveAfterUnix: number;
  thresholdUsd?: string;
}): string {
  const sorted = [...opts.tokenAddresses].map((a) => a.toLowerCase()).sort();
  const thresholdPart =
    opts.thresholdUsd && opts.questionType === "mcap_threshold_first"
      ? `:t${opts.thresholdUsd}`
      : "";
  return `${opts.questionType}:${sorted.join(",")}:${opts.resolveAfterUnix}${thresholdPart}`;
}

function endpointForToken(
  purpose: NadResolutionEndpoint["purpose"],
  token: string,
  apiBase: string,
): NadResolutionEndpoint {
  const t = token.toLowerCase();
  switch (purpose) {
    case "token_info":
      return {
        purpose,
        method: "GET",
        path: `/token/${t}`,
        description: "Token metadata and graduation flag",
      };
    case "token_metadata":
      return {
        purpose,
        method: "GET",
        path: `/token/metadata/${t}`,
        description: "Token + live market snapshot",
      };
    case "market_snapshot":
      return {
        purpose,
        method: "GET",
        path: `/trade/market/${t}`,
        description: "Price, mcap, volume, holders at resolve time",
      };
    case "chart":
      return {
        purpose,
        method: "GET",
        path: `/trade/chart/${t}?chart_type=price_usd`,
        description: "USD price history (OHLCV)",
      };
    case "metrics":
      return {
        purpose,
        method: "GET",
        path: `/trade/metrics/${t}?timeframes=1D`,
        description: "24h % change and volume breakdown",
      };
    case "holders":
      return {
        purpose,
        method: "GET",
        path: `/trade/holder/${t}`,
        description: "Holder list and counts",
      };
    default:
      return { purpose, method: "GET", path: "", description: "" };
  }
}

export function resolutionEndpointsForQuestion(
  questionType: NadQuestionType,
  tokens: NadTokenRef[],
): NadResolutionEndpoint[] {
  const apiBase = nadApiBaseUrl();
  const endpoints: NadResolutionEndpoint[] = [];

  if (questionType === "mcap_highest" || questionType === "mcap_threshold_first") {
    for (const tok of tokens) {
      endpoints.push(endpointForToken("market_snapshot", tok.address, apiBase));
      endpoints.push(endpointForToken("token_metadata", tok.address, apiBase));
      if (questionType === "mcap_threshold_first") {
        endpoints.push(endpointForToken("chart", tok.address, apiBase));
      }
    }
    return endpoints;
  }

  const token = tokens[0]?.address;
  if (!token) return endpoints;

  endpoints.push(endpointForToken("token_metadata", token, apiBase));
  endpoints.push(endpointForToken("market_snapshot", token, apiBase));

  if (questionType === "mcap_usd_above" || questionType === "price_usd_above") {
    endpoints.push(endpointForToken("chart", token, apiBase));
  }
  if (questionType === "holder_count_above") {
    endpoints.push(endpointForToken("holders", token, apiBase));
  }

  return endpoints;
}

export function buildNadTitle(opts: {
  questionType: NadQuestionType;
  tokens: NadTokenRef[];
  params?: { thresholdUsd?: string; holderCount?: number };
  resolveAfterLabel: string;
}): string {
  const { questionType, tokens, params, resolveAfterLabel } = opts;
  const sym = tokens[0]?.symbol ?? "TOKEN";

  switch (questionType) {
    case "mcap_usd_above":
      return `Will $${sym} market cap exceed $${formatUsd(params?.thresholdUsd)} by ${resolveAfterLabel}?`;
    case "price_usd_above":
      return `Will $${sym} price exceed $${formatUsd(params?.thresholdUsd)} by ${resolveAfterLabel}?`;
    case "holder_count_above":
      return `Will $${sym} reach ${params?.holderCount ?? "?"} holders by ${resolveAfterLabel}?`;
    case "mcap_highest": {
      const tickers = tokens.map((t) => `$${t.symbol}`).join(", ");
      return `Which has highest market cap by ${resolveAfterLabel}: ${tickers}?`;
    }
    case "mcap_threshold_first": {
      const tickers = tokens.map((t) => `$${t.symbol}`).join(", ");
      return `Which hits $${formatUsd(params?.thresholdUsd)} mcap first by ${resolveAfterLabel}: ${tickers}?`;
    }
    default:
      return `Token: $${sym}`;
  }
}

function formatUsd(raw?: string): string {
  if (!raw) return "?";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function buildNadOutcomes(questionType: NadQuestionType, tokens: NadTokenRef[]): string[] {
  const def = getQuestionDef(questionType);
  if (def.mode === "binary") return ["Yes", "No"];
  const labels = tokens.map((t) => t.symbol.toUpperCase());
  if (def.includesNeither) labels.push("Neither");
  return labels;
}

export function buildNadResolutionSources(
  questionType: NadQuestionType,
  tokens: NadTokenRef[],
): { label: string; url: string }[] {
  const apiBase = nadApiBaseUrl();
  const endpoints = resolutionEndpointsForQuestion(questionType, tokens);
  return endpoints.map((e) => ({
      label: e.description,
      url: e.path.startsWith("http") ? e.path : `${apiBase}${e.path.split("?")[0]}`,
    }));
}

export function buildNadMarketConfig(opts: {
  questionType: NadQuestionType;
  tokens: NadTokenRef[];
  params?: { thresholdUsd?: string; holderCount?: number };
  resolveAfterUnix: number;
  stakeEndUnix: number;
}): NadMarketConfig {
  const cardBackgroundSeed = opts.tokens[0]?.address.toLowerCase() ?? "0x0";
  const duplicateKey = buildDuplicateKey({
    questionType: opts.questionType,
    tokenAddresses: opts.tokens.map((t) => t.address),
    resolveAfterUnix: opts.resolveAfterUnix,
    thresholdUsd: opts.params?.thresholdUsd,
  });

  return {
    version: 1,
    questionType: opts.questionType,
    mode: getQuestionDef(opts.questionType).mode,
    tokens: opts.tokens,
    params: opts.params,
    apiBaseUrl: nadApiBaseUrl(),
    resolveAfterUnix: opts.resolveAfterUnix,
    stakeEndUnix: opts.stakeEndUnix,
    resolutionEndpoints: resolutionEndpointsForQuestion(opts.questionType, opts.tokens),
    cardBackgroundSeed,
    duplicateKey,
  };
}

export function cardBackgroundFromSeed(seed: string): string {
  const presets = [
    "linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #312e81 100%)",
    "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
    "linear-gradient(135deg, #2d1b4e 0%, #1a1a2e 50%, #0d2137 100%)",
    "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
    "linear-gradient(135deg, #134e4a 0%, #1e3a5f 50%, #312e81 100%)",
    "linear-gradient(135deg, #431407 0%, #1c1917 50%, #292524 100%)",
    "linear-gradient(135deg, #14532d 0%, #1e3a5f 50%, #1e1b4b 100%)",
    "linear-gradient(135deg, #4a044e 0%, #312e81 50%, #1e1b4b 100%)",
  ];
  const hex = seed.replace(/^0x/i, "");
  const idx = parseInt(hex.slice(0, 8), 16) % presets.length;
  return presets[idx] ?? presets[0]!;
}

import type { PrismQuestionType } from "./types";

export type PrismQuestionCategory = "linear" | "vs";

export type PrismQuestionDef = {
  id: PrismQuestionType;
  label: string;
  category: PrismQuestionCategory;
  mode: "binary" | "comparison";
  minAssets: number;
  maxAssets: number;
  needsThreshold?: "usd" | "apy";
  description: string;
};

export const PRISM_LINEAR_QUESTIONS: PrismQuestionDef[] = [
  {
    id: "price_usd_above",
    label: "Price (USD) above threshold",
    category: "linear",
    mode: "binary",
    minAssets: 1,
    maxAssets: 1,
    needsThreshold: "usd",
    description: "Yes if Prism's USD price is at or above your threshold at resolve.",
  },
  {
    id: "mcap_usd_above",
    label: "Market cap (USD) above threshold",
    category: "linear",
    mode: "binary",
    minAssets: 1,
    maxAssets: 1,
    needsThreshold: "usd",
    description: "Yes if Prism's market cap is at or above your threshold at resolve.",
  },
  {
    id: "yield_apy_above",
    label: "Yield (APY %) above threshold",
    category: "linear",
    mode: "binary",
    minAssets: 1,
    maxAssets: 1,
    needsThreshold: "apy",
    description: "Yes if Prism's reported APY is at or above your threshold at resolve.",
  },
];

export const PRISM_VS_QUESTIONS: PrismQuestionDef[] = [
  {
    id: "price_highest",
    label: "Highest USD price",
    category: "vs",
    mode: "comparison",
    minAssets: 2,
    maxAssets: 4,
    description: "Asset with the highest Prism USD price at resolve wins.",
  },
  {
    id: "mcap_highest",
    label: "Highest market cap",
    category: "vs",
    mode: "comparison",
    minAssets: 2,
    maxAssets: 4,
    description: "Asset with the highest Prism market cap at resolve wins.",
  },
  {
    id: "yield_highest",
    label: "Highest yield (APY)",
    category: "vs",
    mode: "comparison",
    minAssets: 2,
    maxAssets: 4,
    description: "Asset with the highest Prism APY at resolve wins.",
  },
];

export const PRISM_QUESTION_GROUPS: {
  id: PrismQuestionCategory;
  label: string;
  questions: PrismQuestionDef[];
}[] = [
  { id: "linear", label: "Linear", questions: PRISM_LINEAR_QUESTIONS },
  { id: "vs", label: "Vs", questions: PRISM_VS_QUESTIONS },
];

export const PRISM_QUESTION_TYPES: PrismQuestionDef[] = [
  ...PRISM_LINEAR_QUESTIONS,
  ...PRISM_VS_QUESTIONS,
];

export function isPrismQuestionType(id: string | null | undefined): id is PrismQuestionType {
  return PRISM_QUESTION_TYPES.some((q) => q.id === id);
}

export function getPrismQuestionDef(id: PrismQuestionType): PrismQuestionDef {
  const def = PRISM_QUESTION_TYPES.find((q) => q.id === id);
  if (!def) throw new Error(`Unknown Prism question type: ${id}`);
  return def;
}

const MIN_RESOLVE_BUFFER_MS = 5 * 60 * 1000;

export function minPrismResolveAfterMs(questionType: PrismQuestionType, fromMs = Date.now()): number {
  void questionType;
  return fromMs + MIN_RESOLVE_BUFFER_MS;
}

export function validatePrismResolveAfter(
  questionType: PrismQuestionType,
  resolveAfterUnix: number,
  fromMs = Date.now(),
): string | null {
  if (!resolveAfterUnix) return "Resolve time is required.";
  const minUnix = Math.floor(minPrismResolveAfterMs(questionType, fromMs) / 1000);
  if (resolveAfterUnix < minUnix) return "Resolve time is too soon.";
  return null;
}

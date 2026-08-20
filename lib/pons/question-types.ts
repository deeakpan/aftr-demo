import type { PonsQuestionType } from "./types";

export type PonsQuestionCategory = "linear" | "vs";

export type PonsQuestionDef = {
  id: PonsQuestionType;
  label: string;
  category: PonsQuestionCategory;
  mode: "binary" | "comparison";
  minTokens: number;
  maxTokens: number;
  needsThreshold?: "usd";
  requiresMcapParity?: boolean;
  minResolveDays?: number;
  description: string;
};

export const PONS_LINEAR_QUESTIONS: PonsQuestionDef[] = [
  {
    id: "mcap_usd_above",
    label: "Market cap (USD) above threshold",
    category: "linear",
    mode: "binary",
    minTokens: 1,
    maxTokens: 1,
    needsThreshold: "usd",
    description: "Yes if implied USD market cap is at or above your threshold at resolve.",
  },
  {
    id: "price_usd_above",
    label: "Token price (USD) above threshold",
    category: "linear",
    mode: "binary",
    minTokens: 1,
    maxTokens: 1,
    needsThreshold: "usd",
    description: "Yes if Uniswap v4 spot price in USD is at or above threshold at resolve.",
  },
];

export const PONS_VS_QUESTIONS: PonsQuestionDef[] = [
  {
    id: "mcap_highest",
    label: "Highest market cap",
    category: "vs",
    mode: "comparison",
    minTokens: 2,
    maxTokens: 4,
    minResolveDays: 4,
    requiresMcapParity: true,
    description: "Token with the highest USD market cap at resolve wins. Resolve at least 4 days out.",
  },
];

export const PONS_QUESTION_GROUPS: { id: PonsQuestionCategory; label: string; questions: PonsQuestionDef[] }[] = [
  { id: "linear", label: "Linear", questions: PONS_LINEAR_QUESTIONS },
  { id: "vs", label: "Vs", questions: PONS_VS_QUESTIONS },
];

export const PONS_QUESTION_TYPES: PonsQuestionDef[] = [...PONS_LINEAR_QUESTIONS, ...PONS_VS_QUESTIONS];

export function isPonsQuestionType(id: string | null | undefined): id is PonsQuestionType {
  return PONS_QUESTION_TYPES.some((q) => q.id === id);
}

export function getPonsQuestionDef(id: PonsQuestionType): PonsQuestionDef {
  const def = PONS_QUESTION_TYPES.find((q) => q.id === id);
  if (!def) throw new Error(`Unknown Pons question type: ${id}`);
  return def;
}

export function isPonsComparisonQuestion(id: PonsQuestionType): boolean {
  return id === "mcap_highest";
}

const MIN_RESOLVE_BUFFER_MS = 5 * 60 * 1000;

export function minPonsResolveAfterMs(questionType: PonsQuestionType, fromMs = Date.now()): number {
  const days = getPonsQuestionDef(questionType).minResolveDays ?? 0;
  const floor = fromMs + MIN_RESOLVE_BUFFER_MS;
  if (days <= 0) return floor;
  return Math.max(floor, fromMs + days * 24 * 60 * 60 * 1000);
}

export function validatePonsResolveAfter(
  questionType: PonsQuestionType,
  resolveAfterUnix: number,
  fromMs = Date.now(),
): string | null {
  if (!resolveAfterUnix) return "Resolve time is required.";
  const minUnix = Math.floor(minPonsResolveAfterMs(questionType, fromMs) / 1000);
  if (resolveAfterUnix < minUnix) {
    const days = getPonsQuestionDef(questionType).minResolveDays ?? 0;
    if (days > 0) {
      return `This question needs at least ${days} days until resolve so the tokens have time to diverge.`;
    }
    return "Resolve time is too soon.";
  }
  return null;
}

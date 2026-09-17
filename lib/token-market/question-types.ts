import type { TokenQuestionType } from "./types";

export type TokenQuestionCategory = "linear" | "vs";

export type TokenQuestionDef = {
  id: TokenQuestionType;
  label: string;
  category: TokenQuestionCategory;
  mode: "binary" | "comparison";
  minTokens: number;
  maxTokens: number;
  needsThreshold?: "usd";
  requiresMcapParity?: boolean;
  minResolveDays?: number;
  description: string;
};

export const TOKEN_LINEAR_QUESTIONS: TokenQuestionDef[] = [
  {
    id: "mcap_usd_above",
    label: "Market cap (USD) above threshold",
    category: "linear",
    mode: "binary",
    minTokens: 1,
    maxTokens: 1,
    needsThreshold: "usd",
    description: "Yes if USD market cap from the pool page is at or above your threshold at resolve.",
  },
  {
    id: "price_usd_above",
    label: "Token price (USD) above threshold",
    category: "linear",
    mode: "binary",
    minTokens: 1,
    maxTokens: 1,
    needsThreshold: "usd",
    description: "Yes if USD price from the pool page is at or above your threshold at resolve.",
  },
];

export const TOKEN_VS_QUESTIONS: TokenQuestionDef[] = [
  {
    id: "mcap_highest",
    label: "Highest market cap",
    category: "vs",
    mode: "comparison",
    minTokens: 2,
    maxTokens: 4,
    requiresMcapParity: true,
    description: "Token with the highest USD market cap at resolve wins (head-to-head).",
  },
  {
    id: "price_highest",
    label: "Highest token price",
    category: "vs",
    mode: "comparison",
    minTokens: 2,
    maxTokens: 4,
    description: "Token with the highest USD price from the pool page at resolve wins (head-to-head).",
  },
];

export const TOKEN_QUESTION_GROUPS: {
  id: TokenQuestionCategory;
  label: string;
  questions: TokenQuestionDef[];
}[] = [
  { id: "linear", label: "Linear", questions: TOKEN_LINEAR_QUESTIONS },
  { id: "vs", label: "Vs", questions: TOKEN_VS_QUESTIONS },
];

export const TOKEN_QUESTION_TYPES: TokenQuestionDef[] = [
  ...TOKEN_LINEAR_QUESTIONS,
  ...TOKEN_VS_QUESTIONS,
];

export function isTokenQuestionType(id: string | null | undefined): id is TokenQuestionType {
  return TOKEN_QUESTION_TYPES.some((q) => q.id === id);
}

export function getTokenQuestionDef(id: TokenQuestionType): TokenQuestionDef {
  const def = TOKEN_QUESTION_TYPES.find((q) => q.id === id);
  if (!def) throw new Error(`Unknown token question type: ${id}`);
  return def;
}

const MIN_RESOLVE_BUFFER_MS = 5 * 60 * 1000;

export function minTokenResolveAfterMs(questionType: TokenQuestionType, fromMs = Date.now()): number {
  const days = getTokenQuestionDef(questionType).minResolveDays ?? 0;
  const floor = fromMs + MIN_RESOLVE_BUFFER_MS;
  if (days <= 0) return floor;
  return Math.max(floor, fromMs + days * 24 * 60 * 60 * 1000);
}

export function validateTokenResolveAfter(
  questionType: TokenQuestionType,
  resolveAfterUnix: number,
  fromMs = Date.now(),
): string | null {
  if (!resolveAfterUnix) return "Resolve time is required.";
  const minUnix = Math.floor(minTokenResolveAfterMs(questionType, fromMs) / 1000);
  if (resolveAfterUnix < minUnix) {
    const days = getTokenQuestionDef(questionType).minResolveDays ?? 0;
    if (days > 0) {
      return `This question needs at least ${days} days until resolve so the tokens have time to diverge.`;
    }
    return "Resolve time is too soon.";
  }
  return null;
}

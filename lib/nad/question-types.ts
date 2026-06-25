import type { NadQuestionType } from "./types";

export type NadQuestionCategory = "linear" | "vs";

export type NadQuestionDef = {
  id: NadQuestionType;
  label: string;
  category: NadQuestionCategory;
  mode: "binary" | "comparison";
  minTokens: number;
  maxTokens: number;
  needsThreshold?: "usd" | "count";
  /** Comparison outcome appended when no token wins (e.g. neither hits target). */
  includesNeither?: boolean;
  /** Vs tokens must be within 10% market cap of the first token. */
  requiresMcapParity?: boolean;
  /** Minimum days from now until resolve (e.g. highest-mcap needs time to flip). */
  minResolveDays?: number;
  /** USD threshold is a target to hit (not a floor vs current). */
  thresholdIsTarget?: boolean;
  description: string;
};

export const NAD_LINEAR_QUESTIONS: NadQuestionDef[] = [
  {
    id: "mcap_usd_above",
    label: "Market cap (USD) above threshold",
    category: "linear",
    mode: "binary",
    minTokens: 1,
    maxTokens: 1,
    needsThreshold: "usd",
    description: "Yes if market cap in USD is at or above your threshold at resolve.",
  },
  {
    id: "price_usd_above",
    label: "Token price (USD) above threshold",
    category: "linear",
    mode: "binary",
    minTokens: 1,
    maxTokens: 1,
    needsThreshold: "usd",
    description: "Yes if token USD price is at or above threshold at resolve.",
  },
  {
    id: "holder_count_above",
    label: "Holder count above threshold",
    category: "linear",
    mode: "binary",
    minTokens: 1,
    maxTokens: 1,
    needsThreshold: "count",
    description: "Yes if holder count meets or exceeds your threshold at resolve.",
  },
];

export const NAD_VS_QUESTIONS: NadQuestionDef[] = [
  {
    id: "mcap_highest",
    label: "Highest market cap",
    category: "vs",
    mode: "comparison",
    minTokens: 2,
    maxTokens: 4,
    minResolveDays: 4,
    description: "The token with the highest USD market cap at resolve time wins. Resolve must be at least 4 days out.",
  },
  {
    id: "mcap_threshold_first",
    label: "First to market cap",
    category: "vs",
    mode: "comparison",
    minTokens: 2,
    maxTokens: 4,
    needsThreshold: "usd",
    includesNeither: true,
    requiresMcapParity: true,
    thresholdIsTarget: true,
    description:
      "Which token hits the target market cap first. Tokens must start within 10% mcap of the first. Neither if none hit it by resolve.",
  },
];

export const NAD_QUESTION_GROUPS: { id: NadQuestionCategory; label: string; questions: NadQuestionDef[] }[] = [
  { id: "linear", label: "Linear", questions: NAD_LINEAR_QUESTIONS },
  { id: "vs", label: "Vs", questions: NAD_VS_QUESTIONS },
];

export const NAD_QUESTION_TYPES: NadQuestionDef[] = [...NAD_LINEAR_QUESTIONS, ...NAD_VS_QUESTIONS];

export function getQuestionDef(id: NadQuestionType): NadQuestionDef {
  const def = NAD_QUESTION_TYPES.find((q) => q.id === id);
  if (!def) throw new Error(`Unknown Nad question type: ${id}`);
  return def;
}

export function isNadMcapComparisonQuestion(id: NadQuestionType): boolean {
  return id === "mcap_highest" || id === "mcap_threshold_first";
}

const MIN_RESOLVE_BUFFER_MS = 5 * 60 * 1000;

/** Earliest allowed resolve time for a question type (ms since epoch). */
export function minResolveAfterMs(questionType: NadQuestionType, fromMs = Date.now()): number {
  const days = getQuestionDef(questionType).minResolveDays ?? 0;
  const floor = fromMs + MIN_RESOLVE_BUFFER_MS;
  if (days <= 0) return floor;
  return Math.max(floor, fromMs + days * 24 * 60 * 60 * 1000);
}

export function validateNadResolveAfter(
  questionType: NadQuestionType,
  resolveAfterUnix: number,
  fromMs = Date.now(),
): string | null {
  if (!resolveAfterUnix) return "Resolve time is required.";
  const minUnix = Math.floor(minResolveAfterMs(questionType, fromMs) / 1000);
  if (resolveAfterUnix < minUnix) {
    const days = getQuestionDef(questionType).minResolveDays ?? 0;
    if (days > 0) {
      return `This question needs at least ${days} days until resolve — with multiple tokens, one usually leads on mcap right away.`;
    }
    return "Resolve time is too soon.";
  }
  return null;
}

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
  /** Comparison outcome appended when no token wins (e.g. neither graduates). */
  includesNeither?: boolean;
  /** Vs tokens must be within 10% market cap of the first token. */
  requiresMcapParity?: boolean;
  /** USD threshold is a target to hit (not a floor vs current). */
  thresholdIsTarget?: boolean;
  description: string;
};

export const NAD_LINEAR_QUESTIONS: NadQuestionDef[] = [
  {
    id: "graduate_by_date",
    label: "Graduate to DEX by date",
    category: "linear",
    mode: "binary",
    minTokens: 1,
    maxTokens: 1,
    description: "Yes if the token has graduated from the bonding curve before resolve time.",
  },
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
    id: "graduate_first",
    label: "Which graduates first",
    category: "vs",
    mode: "comparison",
    minTokens: 2,
    maxTokens: 4,
    includesNeither: true,
    description: "The token that graduates from the bonding curve first wins. Neither if none graduate by resolve.",
  },
  {
    id: "mcap_highest",
    label: "Highest market cap",
    category: "vs",
    mode: "comparison",
    minTokens: 2,
    maxTokens: 4,
    description: "The token with the highest USD market cap at resolve time wins.",
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

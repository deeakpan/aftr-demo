import type { TokenQuestionType } from "./types";
import { PONS_QUESTION_TYPES, getPonsQuestionDef, isPonsQuestionType, validatePonsResolveAfter } from "@/lib/pons/question-types";

export const TOKEN_QUESTION_TYPES = PONS_QUESTION_TYPES;
export const TOKEN_QUESTION_GROUPS = [
  { id: "linear" as const, label: "Linear", questions: PONS_QUESTION_TYPES.filter((q) => q.category === "linear") },
  { id: "vs" as const, label: "Vs", questions: PONS_QUESTION_TYPES.filter((q) => q.category === "vs") },
];

export function isTokenQuestionType(id: string | null | undefined): id is TokenQuestionType {
  return isPonsQuestionType(id);
}

export function getTokenQuestionDef(id: TokenQuestionType) {
  return getPonsQuestionDef(id);
}

export function validateTokenResolveAfter(
  questionType: TokenQuestionType,
  resolveAfterUnix: number,
  fromMs = Date.now(),
) {
  return validatePonsResolveAfter(questionType, resolveAfterUnix, fromMs);
}

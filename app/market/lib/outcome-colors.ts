/** Polymarket-adjacent palette — shared across charts and outcome lists. */
export const OUTCOME_COLORS = [
  "#7eb6ff",
  "#e8a54b",
  "#6ee7b7",
  "#f472b6",
  "#c4b5fd",
  "#fb7185",
  "#fbbf24",
  "#34d399",
] as const;

export function outcomeColor(index: number): string {
  return OUTCOME_COLORS[index % OUTCOME_COLORS.length]!;
}

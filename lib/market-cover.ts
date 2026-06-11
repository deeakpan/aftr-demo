/** Recommended market card cover dimensions (wide horizontal banner). */
export const MARKET_COVER_WIDTH = 851;
export const MARKET_COVER_HEIGHT = 315;
export const MARKET_COVER_ASPECT = MARKET_COVER_WIDTH / MARKET_COVER_HEIGHT;

export const MARKET_COVER_ASPECT_CLASS = "aspect-[851/315]" as const;

export const MARKET_COVER_RATIO_LABEL = `${MARKET_COVER_WIDTH}×${MARKET_COVER_HEIGHT}`;

export function formatMarketCardDate(input: string | number | Date): string | undefined {
  const d =
    input instanceof Date
      ? input
      : typeof input === "number"
        ? new Date(input)
        : new Date(input);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

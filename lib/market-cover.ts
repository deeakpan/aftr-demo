/** Recommended market card cover dimensions (wide horizontal banner). */
export const MARKET_COVER_WIDTH = 851;
export const MARKET_COVER_HEIGHT = 315;
export const MARKET_COVER_ASPECT = MARKET_COVER_WIDTH / MARKET_COVER_HEIGHT;

/**
 * Prefer this class — defined in `app/globals.css` so Tailwind source scanning
 * cannot drop the aspect-ratio utility (lib/ is outside `app/` scan root).
 */
export const MARKET_COVER_ASPECT_CLASS = "market-cover-aspect" as const;

export const MARKET_COVER_RATIO_LABEL = `${MARKET_COVER_WIDTH}×${MARKET_COVER_HEIGHT}`;

/** Short close date for market cards, e.g. "Aug 21, 2026" (time is hover-only). */
export function formatMarketCardDate(input: string | number | Date): string | undefined {
  const d =
    input instanceof Date
      ? input
      : typeof input === "number"
        ? new Date(input)
        : new Date(input);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** Full close time for market-card hover, e.g. "Closes: Jan 1, 2027, 05:59 GMT+1". */
export function formatMarketClosesTooltip(input: string | number | Date): string | undefined {
  const d =
    input instanceof Date
      ? input
      : typeof input === "number"
        ? new Date(input)
        : new Date(input);
  if (Number.isNaN(d.getTime())) return undefined;

  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);

  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).format(d);

  return `Closes: ${datePart}, ${timePart}`;
}

import { parsePolymarketUrl } from "@/lib/polymarket/parse-url";

const GAMMA = "https://gamma-api.polymarket.com";

export type PolymarketChildOption = {
  label: string;
  question: string;
  slug: string;
  endDate: string | null;
};

export type PolymarketImportDraft = {
  sourceUrl: string;
  title: string;
  description: string;
  slug: string;
  imageUrl: string | null;
  /** Polymarket end / resolution deadline (ISO). */
  endDate: string | null;
  /**
   * Suggested Mondalore schedule derived from Poly endDate.
   * Polymarket has no stake-end — we set stake ≈ 24h before resolve (floored to ~6m from now).
   */
  suggestedStakeEndAt: string | null;
  suggestedResolveAfterAt: string | null;
  eventMode: "binary" | "multiple";
  outcomes: string[];
  /** Present when the Poly event has multiple child markets. */
  children: PolymarketChildOption[];
};

/** Build local `datetime-local` values from a Polymarket end date. */
export function scheduleFromPolymarketEnd(endDate: string | null | undefined): {
  stakeEndAt: string | null;
  resolveAfterAt: string | null;
} {
  if (!endDate) return { stakeEndAt: null, resolveAfterAt: null };
  const endMs = Date.parse(endDate);
  if (!Number.isFinite(endMs)) return { stakeEndAt: null, resolveAfterAt: null };

  const now = Date.now();
  const minStake = now + 6 * 60 * 1000;
  const minResolve = now + 12 * 60 * 1000;

  // Prefer Polymarket's end as resolve-after when it's still in the future.
  let resolveMs = endMs;
  if (resolveMs < minResolve) {
    // Past / too soon — keep a usable default window instead of skipping.
    resolveMs = now + 8 * 24 * 60 * 60 * 1000;
  }

  let stakeMs = resolveMs - 24 * 60 * 60 * 1000;
  if (stakeMs < minStake) stakeMs = minStake;
  if (stakeMs >= resolveMs - 5 * 60 * 1000) {
    stakeMs = Math.max(minStake, resolveMs - 60 * 60 * 1000);
  }

  return {
    stakeEndAt: toDateTimeLocalValue(new Date(stakeMs)),
    resolveAfterAt: toDateTimeLocalValue(new Date(resolveMs)),
  };
}

function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function withSchedule(
  draft: Omit<PolymarketImportDraft, "suggestedStakeEndAt" | "suggestedResolveAfterAt">,
): PolymarketImportDraft {
  const schedule = scheduleFromPolymarketEnd(draft.endDate);
  return {
    ...draft,
    suggestedStakeEndAt: schedule.stakeEndAt,
    suggestedResolveAfterAt: schedule.resolveAfterAt,
  };
}

function parseMaybeJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function uniqueLabels(labels: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const label = raw.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * Detect catch-all / residual outcomes that already cover "not one of the named options".
 * Avoids adding a redundant "Other" when Polymarket used a synonym.
 */
export function hasCatchAllOption(options: string[]): boolean {
  return options.some((raw) => isCatchAllLabel(raw));
}

export function isCatchAllLabel(raw: string): boolean {
  const label = raw.trim().toLowerCase();
  if (!label) return false;

  // Exact / near-exact residuals
  const exact = new Set([
    "other",
    "others",
    "else",
    "elsewhere",
    "neither",
    "none",
    "none of the above",
    "not listed",
    "not listed above",
    "not on the list",
    "someone else",
    "something else",
    "somewhere else",
    "another",
    "another team",
    "another option",
    "any other",
    "any other team",
    "field",
    "the field",
    "rest of field",
    "rest of the field",
    "undecided",
    "tbd",
  ]);
  if (exact.has(label)) return true;

  // Phrase / token heuristics (word-boundary style)
  const catchAllPatterns = [
    /\bother\b/,
    /\bothers\b/,
    /\belse\b/,
    /\belsewhere\b/,
    /\bneither\b/,
    /\bnone of the above\b/,
    /\bnot listed\b/,
    /\bnot on (the )?list\b/,
    /\bsomeone else\b/,
    /\bsomething else\b/,
    /\bsomewhere else\b/,
    /\bany other\b/,
    /\banother (team|option|one|club|candidate|player)\b/,
    /\brest of (the )?field\b/,
    /\bthe field\b/,
  ];
  return catchAllPatterns.some((re) => re.test(label));
}

/** Keep options as-is. Do not invent an "Other" — only ~1/4 of multi Poly events include a catch-all. */
export function withOtherOption(options: string[]): string[] {
  return uniqueLabels(options);
}

function childLabel(market: Record<string, unknown>): string {
  const group = str(market.groupItemTitle);
  if (group) return group;
  const question = str(market.question);
  if (question) return question;
  return str(market.slug) || "Option";
}

function mapMarketBinary(market: Record<string, unknown>, sourceUrl: string): PolymarketImportDraft {
  const outcomesRaw = parseMaybeJson<string[]>(market.outcomes);
  const outcomes =
    Array.isArray(outcomesRaw) && outcomesRaw.length >= 2
      ? uniqueLabels(outcomesRaw.map(String)).slice(0, 2)
      : ["Yes", "No"];
  while (outcomes.length < 2) outcomes.push(outcomes.length === 0 ? "Yes" : "No");

  return withSchedule({
    sourceUrl,
    title: str(market.question) || str(market.title) || "Imported market",
    description: str(market.description),
    slug: str(market.slug),
    imageUrl: str(market.image) || str(market.icon) || null,
    endDate: str(market.endDate) || null,
    eventMode: "binary",
    outcomes: outcomes.slice(0, 2),
    children: [],
  });
}

function mapEvent(event: Record<string, unknown>, sourceUrl: string): PolymarketImportDraft {
  const markets = Array.isArray(event.markets)
    ? event.markets.map(asRecord).filter((m): m is Record<string, unknown> => Boolean(m))
    : [];

  if (markets.length <= 1) {
    const market = markets[0] ?? event;
    const draft = mapMarketBinary(market, sourceUrl);
    return withSchedule({
      sourceUrl: draft.sourceUrl,
      title: draft.title || str(event.title) || "Imported market",
      description: draft.description || str(event.description),
      slug: draft.slug || str(event.slug),
      imageUrl: draft.imageUrl || str(event.image) || str(event.icon) || null,
      endDate: draft.endDate || str(event.endDate) || null,
      eventMode: draft.eventMode,
      outcomes: draft.outcomes,
      children: draft.children,
    });
  }

  const children: PolymarketChildOption[] = markets.map((m) => ({
    label: childLabel(m),
    question: str(m.question),
    slug: str(m.slug),
    endDate: str(m.endDate) || null,
  }));

  const optionLabels = withOtherOption(children.map((c) => c.label));
  const latestEnd =
    children
      .map((c) => c.endDate)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) || str(event.endDate) || null;

  return withSchedule({
    sourceUrl,
    title: str(event.title) || "Imported market",
    description: str(event.description),
    slug: str(event.slug),
    imageUrl: str(event.image) || str(event.icon) || null,
    endDate: latestEnd,
    eventMode: "multiple",
    outcomes: optionLabels,
    children,
  });
}

async function gammaGet(path: string): Promise<unknown> {
  const res = await fetch(`${GAMMA}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Polymarket API error (${res.status}).`);
  }
  return res.json();
}

export async function fetchPolymarketImport(urlInput: string): Promise<PolymarketImportDraft> {
  const parsed = parsePolymarketUrl(urlInput);
  if (!parsed) {
    throw new Error("Paste a valid Polymarket event or market URL (polymarket.com/event/…).");
  }

  if (parsed.kind === "event") {
    const data = await gammaGet(`/events/slug/${encodeURIComponent(parsed.slug)}`);
    const event = asRecord(data);
    if (!event) throw new Error("Polymarket event not found for that link.");
    return mapEvent(event, parsed.canonicalUrl);
  }

  const data = await gammaGet(`/markets/slug/${encodeURIComponent(parsed.slug)}`);
  const market = asRecord(data);
  if (!market) throw new Error("Polymarket market not found for that link.");
  return mapMarketBinary(market, parsed.canonicalUrl);
}

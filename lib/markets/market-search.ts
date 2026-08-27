import type { NadMarketConfig } from "@/lib/nad/types";

export type MarketSearchRecord = {
  address: `0x${string}`;
  kind: string;
  title: string;
  description: string;
  slug?: string;
  categories?: string[];
  outcomeLabels: string[];
  nadMarket?: NadMarketConfig;
  poolTvl?: string;
  imageUrl?: string;
  stakeEndUnix?: number;
};

export type MarketSearchHit<T extends MarketSearchRecord = MarketSearchRecord> = {
  market: T;
  score: number;
  matchedFields: string[];
};

function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function marketSearchBlob(market: MarketSearchRecord): string {
  const tokens = market.nadMarket?.tokens ?? [];
  const tokenText = tokens
    .flatMap((t) => [t.symbol, t.name, t.address, t.address.slice(2)])
    .join(" ");

  return [
    market.title,
    market.description,
    market.slug ?? "",
    market.kind,
    market.address,
    market.address.slice(2),
    ...(market.categories ?? []),
    ...market.outcomeLabels,
    tokenText,
  ]
    .join(" ")
    .toLowerCase();
}

function scoreTerm(market: MarketSearchRecord, term: string, matched: Set<string>): number {
  const title = market.title.toLowerCase();
  const address = market.address.toLowerCase();
  let score = 8;

  if (title === term) {
    score += 100;
    matched.add("title");
  } else if (title.startsWith(term)) {
    score += 60;
    matched.add("title");
  } else if (title.includes(term)) {
    score += 35;
    matched.add("title");
  }

  if (address === term || address.includes(term)) {
    score += term.length >= 6 ? 70 : 40;
    matched.add("address");
  }

  if (market.slug?.toLowerCase().includes(term)) {
    score += 30;
    matched.add("slug");
  }

  for (const token of market.nadMarket?.tokens ?? []) {
    const sym = token.symbol.toLowerCase();
    const name = token.name.toLowerCase();
    if (sym === term || sym === term.replace(/^\$/, "")) {
      score += 85;
      matched.add("token");
    } else if (sym.includes(term)) {
      score += 40;
      matched.add("token");
    }
    if (name.includes(term)) {
      score += 22;
      matched.add("token");
    }
    if (token.address.toLowerCase().includes(term)) {
      score += 55;
      matched.add("token");
    }
  }

  for (const label of market.outcomeLabels) {
    if (label.toLowerCase().includes(term)) {
      score += 18;
      matched.add("outcome");
    }
  }

  for (const cat of market.categories ?? []) {
    if (cat.toLowerCase().includes(term)) {
      score += 15;
      matched.add("category");
    }
  }

  if (market.kind.toLowerCase().includes(term)) {
    score += 12;
    matched.add("kind");
  }

  if (market.description.toLowerCase().includes(term)) {
    score += 10;
    matched.add("description");
  }

  return score;
}

export function searchMarkets<T extends MarketSearchRecord>(
  markets: T[],
  query: string,
  options?: { limit?: number; activeOnly?: boolean; now?: number },
): MarketSearchHit<T>[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const now = options?.now ?? Math.floor(Date.now() / 1000);
  const limit = options?.limit ?? 20;
  const hits: MarketSearchHit<T>[] = [];

  for (const market of markets) {
    if (options?.activeOnly && market.stakeEndUnix !== undefined && market.stakeEndUnix <= now) {
      continue;
    }

    const blob = marketSearchBlob(market);
    const matched = new Set<string>();
    let score = 0;
    let allMatch = true;

    for (const term of terms) {
      if (!blob.includes(term)) {
        allMatch = false;
        break;
      }
      score += scoreTerm(market, term, matched);
    }

    if (!allMatch) continue;
    hits.push({ market, score, matchedFields: [...matched] });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function marketSearchSubtitle(market: MarketSearchRecord): string {
  const tokens = market.nadMarket?.tokens ?? [];
  if (tokens.length > 0) {
    return tokens.map((t) => `$${t.symbol}`).join(" · ");
  }
  if (market.categories && market.categories.length > 0) {
    return market.categories.slice(0, 3).join(" · ");
  }
  if (market.outcomeLabels.length > 0 && market.outcomeLabels.length <= 4) {
    return market.outcomeLabels.join(" · ");
  }
  if (market.poolTvl) return `TVL ${market.poolTvl}`;
  return market.kind;
}

export function marketKindBadge(kind: string): string {
  switch (kind) {
    case "Pons":
      return "PONS";
    case "Nad":
      return "NAD";
    case "Price":
      return "Price";
    case "Event":
      return "Event";
    default:
      return kind;
  }
}

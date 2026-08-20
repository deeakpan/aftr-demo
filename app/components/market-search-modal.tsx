"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleNotch, MagnifyingGlass, TrendUp } from "@phosphor-icons/react";
import {
  marketKindBadge,
  marketSearchSubtitle,
  searchMarkets,
  type MarketSearchRecord,
} from "@/lib/markets/market-search";
import { marketPath } from "@/lib/markets/market-url";

type Props = {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
  /** Sync typed query to markets page URL filter (optional). */
  onQueryChange?: (query: string) => void;
};

export function MarketSearchModal({ open, onClose, initialQuery = "", onQueryChange }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [markets, setMarkets] = useState<MarketSearchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setActiveIndex(0);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void (async () => {
      try {
        const res = await fetch("/api/markets");
        const json = (await res.json()) as { markets?: MarketSearchRecord[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Could not load markets.");
        if (!cancelled) setMarkets(json.markets ?? []);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load markets.");
          setMarkets([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const hits = useMemo(() => {
    if (!query.trim()) {
      const now = Math.floor(Date.now() / 1000);
      return markets
        .filter((m) => (m.stakeEndUnix ?? Number.MAX_SAFE_INTEGER) > now)
        .slice(0, 8)
        .map((market) => ({ market, score: 0, matchedFields: [] as string[] }));
    }
    return searchMarkets(markets, query, { limit: 12, activeOnly: true });
  }, [markets, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, hits.length]);

  const openMarket = useCallback(
    (market: MarketSearchRecord) => {
      onClose();
      router.push(marketPath({ slug: market.slug, address: market.address }));
    },
    [onClose, router],
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    onQueryChange?.(value);
  };

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (hits.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % hits.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + hits.length) % hits.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const hit = hits[activeIndex];
        if (hit) openMarket(hit.market);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, hits, activeIndex, onClose, openMarket]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-search-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open) return null;

  const showEmpty = !loading && !loadError && query.trim() && hits.length === 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-[var(--overlay-scrim)] px-4 pb-8 pt-[12vh] backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search markets"
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <MagnifyingGlass size={20} weight="bold" className="shrink-0 text-[var(--muted)]" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search by title, token, outcome, or address…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)] sm:inline">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[min(52vh,420px)] overflow-y-auto p-2">
          {loading && (
            <div className="flex items-center justify-center px-3 py-10">
              <CircleNotch size={28} weight="bold" className="animate-spin text-[var(--muted)]" aria-label="Loading markets" />
            </div>
          )}
          {loadError && (
            <p className="px-3 py-6 text-center text-sm text-red-400">{loadError}</p>
          )}
          {!loading && !loadError && !query.trim() && hits.length > 0 && (
            <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Open markets
            </p>
          )}
          {!loading &&
            !loadError &&
            hits.map((hit, index) => {
              const { market } = hit;
              const active = index === activeIndex;
              return (
                <button
                  key={market.address}
                  type="button"
                  data-search-index={index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => openMarket(market)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    active ? "bg-[var(--accent)]/12 ring-1 ring-[var(--accent)]/25" : "hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  {market.imageUrl ? (
                    <img
                      src={market.imageUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-[var(--border)]"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--muted)] ring-1 ring-[var(--border)]">
                      <TrendUp size={18} weight="bold" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--foreground)]">{market.title}</span>
                      <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--muted)]">
                        {marketKindBadge(market.kind)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                      {marketSearchSubtitle(market)}
                    </span>
                  </span>
                </button>
              );
            })}
          {showEmpty && (
            <p className="px-3 py-8 text-center text-sm text-[var(--muted)]">
              No markets match &ldquo;{query.trim()}&rdquo;
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface)]/60 px-4 py-2 text-[10px] text-[var(--muted)]">
          <span>Title · token · outcome · category · address</span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-[var(--border)] px-1">↑↓</kbd> navigate{" "}
            <kbd className="rounded border border-[var(--border)] px-1">↵</kbd> open
          </span>
        </div>
      </div>
    </div>
  );
}

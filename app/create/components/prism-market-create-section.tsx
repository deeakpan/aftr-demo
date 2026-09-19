"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, CircleNotch, MagnifyingGlass, Plus, Trash, X } from "@phosphor-icons/react";
import { PRISM_BRAND_LOGO_PATH, prismAssetLogoUrl } from "@/lib/prism/config";
import {
  PRISM_QUESTION_GROUPS,
  getPrismQuestionDef,
  isPrismQuestionType,
  validatePrismResolveAfter,
} from "@/lib/prism/question-types";
import {
  buildPrismDescription,
  buildPrismMarketConfig,
  buildPrismOutcomes,
  buildPrismResolutionSources,
  buildPrismTitle,
} from "@/lib/prism/metadata";
import type {
  PrismAssetRef,
  PrismCatalogueAsset,
  PrismLiveStats,
  PrismMarketConfig,
  PrismQuestionType,
} from "@/lib/prism/types";

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] sm:text-sm";
const glassSelectTriggerClass =
  "flex w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md outline-none transition hover:border-white/15 focus:border-[var(--accent)]/50 focus:ring-2 focus:ring-[var(--accent)]/20 sm:max-w-md [html[data-theme=light]_&]:border-black/[0.08] [html[data-theme=light]_&]:bg-white/60";
const labelClass = "text-xs font-semibold uppercase tracking-wider text-[var(--muted)]";
const dropdownListClass =
  "styled-scroll absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-[var(--elevated-card-shadow)]";

type CatalogueOption = {
  slug: string;
  symbol: string;
  name: string;
  category: string;
  imageUri: string;
  address?: string;
  chain?: string;
  stats: PrismLiveStats;
};

const CATALOGUE_PAGE_SIZE = 48;

function catalogueToOption(item: PrismCatalogueAsset): CatalogueOption {
  const primary =
    item.deployments?.find((d) => d.isPrimary && d.address) ??
    item.deployments?.find((d) => d.address);
  const n = (v: unknown) => {
    if (v == null || v === "") return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    slug: item.slug,
    symbol: item.symbol,
    name: item.name,
    category: item.category,
    imageUri: prismAssetLogoUrl(item.slug),
    address: primary?.address ?? undefined,
    chain: primary?.chain,
    stats: {
      priceUsd: n(item.priceUsd),
      marketCapUsd: n(item.marketCapUsd),
      yieldApyPct: n(item.yieldApyPct),
      change24hPct: n(item.change24hPct),
    },
  };
}

async function fetchCataloguePage(opts: {
  cursor?: string | number | null;
  q?: string;
}): Promise<{
  items: CatalogueOption[];
  nextCursor: string | number | null;
  total: number | null;
}> {
  const sp = new URLSearchParams({
    limit: String(CATALOGUE_PAGE_SIZE),
    sort: "marketCap",
  });
  if (opts.cursor != null && opts.cursor !== "") sp.set("cursor", String(opts.cursor));
  const q = opts.q?.trim();
  if (q) sp.set("q", q);
  const res = await fetch(`/api/prism/assets?${sp}`, { cache: "no-store" });
  const json = (await res.json()) as {
    items?: PrismCatalogueAsset[];
    nextCursor?: string | number | null;
    total?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(json.error || "Could not load Prism assets");
  return {
    items: (json.items ?? []).map(catalogueToOption),
    nextCursor: json.nextCursor ?? null,
    total: typeof json.total === "number" ? json.total : null,
  };
}

function parseLocalDateTimeToMs(value: string): number {
  if (!value) return 0;
  return new Date(value).getTime();
}

function formatResolveLabel(resolveAfterAt: string): string {
  const ms = parseLocalDateTimeToMs(resolveAfterAt);
  if (!ms) return "resolve time";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatApy(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

export type PrismCreateDraft = {
  title: string;
  description: string;
  outcomes: string[];
  resolutionSources: { label: string; url: string }[];
  prismMarket: PrismMarketConfig;
  coverImageUrl: string;
  slug: string;
  previewTokenStats?: (PrismLiveStats | null)[];
};

type Props = {
  stakeEndAt: string;
  resolveAfterAt: string;
  slug: string;
  questionType: PrismQuestionType;
  onQuestionTypeChange: (type: PrismQuestionType) => void;
  onSlugChange: (slug: string, manual?: boolean) => void;
  onDraftChange: (draft: PrismCreateDraft | null) => void;
};

export function PrismMarketCreateSection({
  stakeEndAt,
  resolveAfterAt,
  slug,
  questionType,
  onQuestionTypeChange,
  onDraftChange,
}: Props) {
  const def = getPrismQuestionDef(questionType);
  const slotCount = def.mode === "binary" ? 1 : Math.max(2, def.minAssets);
  const [assets, setAssets] = useState<(PrismAssetRef | null)[]>(() =>
    Array.from({ length: slotCount }, () => null),
  );
  const [stats, setStats] = useState<(PrismLiveStats | null)[]>(() =>
    Array.from({ length: slotCount }, () => null),
  );
  const [thresholdUsd, setThresholdUsd] = useState("4000");
  const [thresholdApy, setThresholdApy] = useState("4");
  const [catalogue, setCatalogue] = useState<CatalogueOption[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueLoadingMore, setCatalogueLoadingMore] = useState(false);
  const [catalogueNextCursor, setCatalogueNextCursor] = useState<string | number | null>(null);
  const [catalogueTotal, setCatalogueTotal] = useState<number | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerQueryDebounced, setPickerQueryDebounced] = useState("");
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);
  const questionMenuRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setPickerQueryDebounced(pickerQuery.trim()), 250);
    return () => window.clearTimeout(t);
  }, [pickerQuery]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setCatalogueLoading(true);
      setCatalogue([]);
      setCatalogueNextCursor(null);
      try {
        const page = await fetchCataloguePage({ q: pickerQueryDebounced || undefined });
        if (!cancelled) {
          setCatalogue(page.items);
          setCatalogueNextCursor(page.nextCursor);
          setCatalogueTotal(page.total);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setCatalogue([]);
          setCatalogueNextCursor(null);
          setCatalogueTotal(null);
          setError(e instanceof Error ? e.message : "Could not load Prism assets");
        }
      } finally {
        if (!cancelled) setCatalogueLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerQueryDebounced]);

  const loadMoreCatalogue = useCallback(async () => {
    if (catalogueLoading || catalogueLoadingMore || catalogueNextCursor == null) return;
    setCatalogueLoadingMore(true);
    try {
      const page = await fetchCataloguePage({
        cursor: catalogueNextCursor,
        q: pickerQueryDebounced || undefined,
      });
      setCatalogue((prev) => {
        const seen = new Set(prev.map((c) => c.slug));
        const merged = [...prev];
        for (const item of page.items) {
          if (!seen.has(item.slug)) {
            seen.add(item.slug);
            merged.push(item);
          }
        }
        return merged;
      });
      setCatalogueNextCursor(page.nextCursor);
      if (page.total != null) setCatalogueTotal(page.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more assets");
    } finally {
      setCatalogueLoadingMore(false);
    }
  }, [
    catalogueLoading,
    catalogueLoadingMore,
    catalogueNextCursor,
    pickerQueryDebounced,
  ]);

  useEffect(() => {
    if (pickerSlot == null) return;
    const el = listScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
        void loadMoreCatalogue();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [pickerSlot, loadMoreCatalogue]);

  useEffect(() => {
    if (!questionMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!questionMenuRef.current?.contains(e.target as Node)) setQuestionMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [questionMenuOpen]);

  useEffect(() => {
    if (pickerSlot == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerSlot(null);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [pickerSlot]);

  const selectQuestionType = useCallback(
    (nextType: PrismQuestionType) => {
      if (!isPrismQuestionType(nextType)) return;
      onQuestionTypeChange(nextType);
      setQuestionMenuOpen(false);
      setPickerSlot(null);
      setError("");
    },
    [onQuestionTypeChange],
  );

  useEffect(() => {
    const nextLen = def.mode === "binary" ? 1 : Math.max(def.minAssets, assets.filter(Boolean).length || 2);
    setAssets((prev) => {
      const next = prev.slice(0, nextLen);
      while (next.length < nextLen) next.push(null);
      return next;
    });
    setStats((prev) => {
      const next = prev.slice(0, nextLen);
      while (next.length < nextLen) next.push(null);
      return next;
    });
    setPickerSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resize slots when question mode changes
  }, [questionType, def.mode, def.minAssets]);

  const pickAsset = useCallback((opt: CatalogueOption, slot: number) => {
    setLoadingSlug(opt.slug);
    setError("");
    const ref: PrismAssetRef = {
      slug: opt.slug,
      symbol: opt.symbol,
      name: opt.name,
      category: opt.category,
      imageUri: opt.imageUri,
      address: opt.address,
      chain: opt.chain,
    };
    setAssets((prev) => {
      const next = [...prev];
      next[slot] = ref;
      return next;
    });
    setStats((prev) => {
      const next = [...prev];
      next[slot] = opt.stats;
      return next;
    });
    setLoadingSlug(null);
    setPickerSlot(null);
  }, []);

  const openPicker = useCallback((slot: number) => {
    setQuestionMenuOpen(false);
    setPickerQuery("");
    setPickerQueryDebounced("");
    setPickerSlot(slot);
  }, []);

  const addAssetSlot = useCallback(() => {
    if (assets.length >= def.maxAssets) return;
    const nextIdx = assets.length;
    setAssets((prev) => [...prev, null]);
    setStats((prev) => [...prev, null]);
    setPickerSlot(nextIdx);
  }, [assets.length, def.maxAssets]);

  const filled = useMemo(() => assets.filter((a): a is PrismAssetRef => Boolean(a)), [assets]);

  const optionsForSlot = useCallback(
    (slot: number) => {
      const taken = new Set(
        assets.map((a, i) => (i !== slot && a ? a.slug : null)).filter(Boolean) as string[],
      );
      return catalogue.filter((c) => !taken.has(c.slug));
    },
    [assets, catalogue],
  );

  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const lastDraftKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const resolveUnix = Math.floor(parseLocalDateTimeToMs(resolveAfterAt) / 1000);
    const stakeUnix = Math.floor(parseLocalDateTimeToMs(stakeEndAt) / 1000);
    const clearDraft = () => {
      if (lastDraftKeyRef.current !== null) {
        lastDraftKeyRef.current = null;
        onDraftChangeRef.current(null);
      }
    };

    if (filled.length < def.minAssets || !resolveUnix || !stakeUnix) {
      clearDraft();
      return;
    }
    const resolveErr = validatePrismResolveAfter(questionType, resolveUnix);
    if (resolveErr) {
      clearDraft();
      return;
    }
    if (def.needsThreshold === "usd" && !(Number(thresholdUsd) > 0)) {
      clearDraft();
      return;
    }
    if (def.needsThreshold === "apy" && !(Number(thresholdApy) >= 0)) {
      clearDraft();
      return;
    }
    if (def.mode === "comparison" && filled.length > def.maxAssets) {
      clearDraft();
      return;
    }

    const resolveLabel = formatResolveLabel(resolveAfterAt);
    const prismMarket = buildPrismMarketConfig({
      questionType,
      assets: filled,
      resolveAfterUnix: resolveUnix,
      stakeEndUnix: stakeUnix,
      thresholdUsd: def.needsThreshold === "usd" ? thresholdUsd : undefined,
      thresholdApyPct: def.needsThreshold === "apy" ? thresholdApy : undefined,
    });
    const title = buildPrismTitle(
      questionType,
      filled,
      { thresholdUsd, thresholdApyPct: thresholdApy },
      resolveLabel,
    );
    const previewTokenStats = filled.map((asset) => {
      const i = assets.findIndex((a) => a?.slug === asset.slug);
      return i >= 0 ? stats[i] ?? null : null;
    });
    const draftKey = JSON.stringify({
      title,
      questionType,
      resolveUnix,
      stakeUnix,
      thresholdUsd: def.needsThreshold === "usd" ? thresholdUsd : null,
      thresholdApy: def.needsThreshold === "apy" ? thresholdApy : null,
      slugs: filled.map((a) => a.slug),
      preview: previewTokenStats,
    });
    if (lastDraftKeyRef.current === draftKey) return;
    lastDraftKeyRef.current = draftKey;

    // Parent auto-slugs from draft.title — do not call onSlugChange here (inline
    // parent handlers + setSlug feedback loops max update depth).
    onDraftChangeRef.current({
      title,
      description: buildPrismDescription(filled, questionType),
      outcomes: buildPrismOutcomes(questionType, filled),
      resolutionSources: buildPrismResolutionSources(filled),
      prismMarket,
      coverImageUrl: filled[0]?.imageUri || "",
      slug: slug || slugify(title),
      previewTokenStats,
    });
  }, [
    assets,
    def.maxAssets,
    def.minAssets,
    def.mode,
    def.needsThreshold,
    filled,
    questionType,
    resolveAfterAt,
    slug,
    stakeEndAt,
    stats,
    thresholdApy,
    thresholdUsd,
  ]);

  return (
    <div className="space-y-6 py-8">
      <div className="flex items-center gap-3">
        <img src={PRISM_BRAND_LOGO_PATH} alt="" className="h-8 w-8 rounded-lg bg-black/40 p-1" />
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">RWA market · Prism</p>
          <p className="text-xs text-[var(--muted)]">
            Pick verified tokenized assets. The resolver bot reads Prism at resolve time.
          </p>
        </div>
      </div>

      <section>
        <p className={labelClass}>Question type</p>
        <div ref={questionMenuRef} className="relative mt-3 max-w-md">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={questionMenuOpen}
            onClick={() => setQuestionMenuOpen((o) => !o)}
            className={glassSelectTriggerClass}
          >
            <span>{def.label}</span>
            <CaretDown
              size={14}
              weight="bold"
              className={`shrink-0 text-[var(--muted)] transition ${questionMenuOpen ? "rotate-180" : ""}`}
            />
          </button>
          {questionMenuOpen ? (
            <ul role="listbox" className={dropdownListClass}>
              {PRISM_QUESTION_GROUPS.map((group, groupIdx) => (
                <li key={group.id}>
                  {groupIdx > 0 ? (
                    <div className="mx-3 my-1 border-t border-[var(--border)]" aria-hidden />
                  ) : null}
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    {group.label}
                  </p>
                  <ul>
                    {group.questions.map((q) => {
                      const selected = questionType === q.id;
                      return (
                        <li key={q.id} role="option" aria-selected={selected}>
                          <button
                            type="button"
                            onClick={() => selectQuestionType(q.id)}
                            className={`w-full px-3 py-2.5 text-left text-sm transition ${
                              selected
                                ? "bg-[var(--accent)]/15 font-medium text-[var(--foreground)]"
                                : "text-[var(--foreground)] hover:bg-[var(--surface-hover)]"
                            }`}
                          >
                            {q.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-[var(--muted)]">{def.description}</p>
      </section>

      {def.needsThreshold === "usd" ? (
        <section>
          <label className={labelClass}>USD threshold</label>
          <input
            className={fieldClass}
            value={thresholdUsd}
            onChange={(e) => setThresholdUsd(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="4000"
          />
        </section>
      ) : null}

      {def.needsThreshold === "apy" ? (
        <section>
          <label className={labelClass}>APY threshold (%)</label>
          <input
            className={fieldClass}
            value={thresholdApy}
            onChange={(e) => setThresholdApy(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="4.25"
          />
        </section>
      ) : null}

      <section>
        <p className={labelClass}>Assets</p>
        <div className="mt-4 space-y-4">
          {assets.map((asset, idx) => (
            <div key={`slot-${idx}`} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[var(--muted)]">
                  {def.mode === "binary" ? "Asset" : `Outcome ${idx + 1}`}
                </p>
                {def.mode === "comparison" && assets.length > def.minAssets ? (
                  <button
                    type="button"
                    className="text-[var(--muted)] hover:text-[var(--outcome-no)]"
                    onClick={() => {
                      setAssets((prev) => prev.filter((_, i) => i !== idx));
                      setStats((prev) => prev.filter((_, i) => i !== idx));
                      setPickerSlot(null);
                    }}
                    aria-label="Remove asset"
                  >
                    <Trash size={14} />
                  </button>
                ) : null}
              </div>

              {asset ? (
                <div className="flex items-center gap-3 py-1">
                  {asset.imageUri ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.imageUri}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover ring-1 ring-[var(--border)]"
                    />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] text-[10px] font-bold">
                      {asset.symbol.slice(0, 3)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {asset.symbol}{" "}
                      <span className="font-normal text-[var(--muted)]">{asset.name}</span>
                    </p>
                    <p className="text-[11px] text-[var(--muted)]">
                      {formatUsd(stats[idx]?.priceUsd)} · mcap {formatUsd(stats[idx]?.marketCapUsd)} · APY{" "}
                      {formatApy(stats[idx]?.yieldApyPct)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs font-medium text-[var(--accent)] hover:underline"
                    onClick={() => openPicker(idx)}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openPicker(idx)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface-hover)]"
                >
                  <Plus size={14} weight="bold" />
                  Add asset
                </button>
              )}
            </div>
          ))}
        </div>

        {def.mode === "comparison" && assets.length < def.maxAssets ? (
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:underline"
            onClick={addAssetSlot}
          >
            <Plus size={12} weight="bold" /> Add another outcome
          </button>
        ) : null}
      </section>

      {error ? <p className="text-xs text-[var(--outcome-no)]">{error}</p> : null}

      {pickerSlot != null ? (
        <div
          className="fixed inset-0 z-[90] flex flex-col justify-end bg-[var(--overlay-scrim)] backdrop-blur-[2px] md:items-center md:justify-center md:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPickerSlot(null);
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="prism-asset-picker-title"
            className="trade-sheet-panel relative flex max-h-[min(88dvh,36rem)] min-h-0 w-full flex-col overflow-hidden rounded-t-2xl bg-[var(--card)] shadow-[var(--elevated-card-shadow)] md:max-w-md md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 md:px-5">
              <div className="min-w-0">
                <p id="prism-asset-picker-title" className="text-sm font-semibold text-[var(--foreground)]">
                  Select asset
                </p>
                <p className="text-[11px] text-[var(--muted)]">
                  {def.mode === "binary" ? "Prism RWA" : `Outcome ${(pickerSlot ?? 0) + 1}`}
                  {catalogueTotal != null
                    ? ` · ${catalogue.length.toLocaleString()}${
                        catalogueNextCursor != null ? "+" : ""
                      } of ${catalogueTotal.toLocaleString()}`
                    : null}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPickerSlot(null)}
                className="rounded-full p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="shrink-0 border-b border-[var(--border)] px-3 py-2 md:px-4">
              <label className="relative block">
                <MagnifyingGlass
                  size={16}
                  weight="bold"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
                  aria-hidden
                />
                <input
                  type="search"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search ticker, name, or category…"
                  autoFocus
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-label="Search Prism RWA catalogue"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-9 pr-9 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
                />
                {pickerQuery ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setPickerQuery("");
                      setPickerQueryDebounced("");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                  >
                    <X size={14} weight="bold" />
                  </button>
                ) : null}
              </label>
            </div>

            <div
              ref={listScrollRef}
              className="styled-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 md:px-3"
            >
              {catalogueLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-xs text-[var(--muted)]">
                  <CircleNotch size={16} className="animate-spin" />
                  Loading assets…
                </div>
              ) : optionsForSlot(pickerSlot).length === 0 ? (
                <p className="px-3 py-10 text-center text-xs text-[var(--muted)]">
                  {pickerQueryDebounced ? "No assets match that search." : "No assets left to pick."}
                </p>
              ) : (
                <>
                  <ul role="listbox">
                    {optionsForSlot(pickerSlot).map((opt) => {
                      const selected = assets[pickerSlot]?.slug === opt.slug;
                      return (
                        <li key={opt.slug} role="option" aria-selected={selected}>
                          <button
                            type="button"
                            disabled={loadingSlug === opt.slug}
                            onClick={() => pickAsset(opt, pickerSlot)}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition disabled:opacity-50 ${
                              selected
                                ? "bg-[var(--accent)]/15 text-[var(--foreground)]"
                                : "text-[var(--foreground)] hover:bg-[var(--surface-hover)]"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={opt.imageUri}
                              alt=""
                              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-semibold">{opt.symbol}</span>
                              <span className="ml-1.5 text-[var(--muted)]">{opt.name}</span>
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted)]">
                              {formatUsd(opt.stats.priceUsd)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {catalogueNextCursor != null ? (
                    <div className="flex justify-center py-3">
                      <button
                        type="button"
                        disabled={catalogueLoadingMore}
                        onClick={() => void loadMoreCatalogue()}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--foreground)] disabled:opacity-50"
                      >
                        {catalogueLoadingMore ? (
                          <>
                            <CircleNotch size={12} className="animate-spin" /> Loading…
                          </>
                        ) : (
                          "Load more"
                        )}
                      </button>
                    </div>
                  ) : catalogue.length > 0 ? (
                    <p className="py-3 text-center text-[11px] text-[var(--muted)]">End of list</p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import { CaretDown, Check, CircleNotch, Plus, Trash } from "@phosphor-icons/react";
import type { TokenLiveStats, TokenPairRef, TokenQuestionType } from "@/lib/token-market/types";
import type { TokenMarketConfig } from "@/lib/token-market/types";
import { TOKEN_QUESTION_GROUPS, getTokenQuestionDef, isTokenQuestionType, validateTokenResolveAfter } from "@/lib/token-market/question-types";
import {
  buildTokenMarketConfig,
  buildTokenOutcomes,
  buildTokenResolutionSources,
  buildTokenTitle,
} from "@/lib/token-market/metadata";
import {
  defaultUsdThreshold,
  formatPonsMcapUsd as formatMcapUsd,
  formatPonsPriceUsd as formatPriceUsd,
  formatUsdThresholdValue,
  usdThresholdSliderRange,
  validateMcapParity,
} from "@/lib/pons/market-stats";

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] sm:text-sm";
const glassInputClass =
  "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md outline-none transition placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)]/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-[var(--accent)]/20 sm:max-w-lg [html[data-theme=light]_&]:border-black/[0.08] [html[data-theme=light]_&]:bg-white/60";
const glassSelectTriggerClass =
  "flex w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md outline-none transition hover:border-white/15 focus:border-[var(--accent)]/50 focus:ring-2 focus:ring-[var(--accent)]/20 sm:max-w-md [html[data-theme=light]_&]:border-black/[0.08] [html[data-theme=light]_&]:bg-white/60";
const labelClass = "text-xs font-semibold uppercase tracking-wider text-[var(--muted)]";
const HEAT_GRADIENT =
  "linear-gradient(to right, #38bdf8 0%, #22d3ee 28%, #facc15 52%, #f97316 78%, #ef4444 100%)";

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

function ThresholdSlider({
  min,
  max,
  step,
  value,
  onChange,
  label,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const readyRef = useRef(false);
  const clamped = Math.min(max, Math.max(min, value));
  const pct = ((clamped - min) / Math.max(1, max - min)) * 100;
  useEffect(() => {
    readyRef.current = true;
  }, []);
  return (
    <Slider.Root
      min={min}
      max={max}
      step={step}
      value={[clamped]}
      onValueChange={(vals) => {
        if (!readyRef.current) return;
        const next = vals[0] ?? min;
        if (next !== clamped) onChange(next);
      }}
      aria-label={label}
      className="relative flex h-7 w-52 touch-none items-center select-none"
    >
      <Slider.Track className="relative h-2.5 w-full grow cursor-pointer">
        <span className="absolute inset-0 overflow-hidden [clip-path:polygon(0%_38%,100%_4%,100%_96%,0%_62%)]" style={{ background: HEAT_GRADIENT }}>
          <span className="absolute inset-y-0 right-0 bg-black/55" style={{ width: `${Math.max(0, 100 - pct)}%` }} />
        </span>
      </Slider.Track>
      <Slider.Thumb className="block size-5 cursor-grab rounded-full border-2 border-amber-400 bg-white outline-none" />
    </Slider.Root>
  );
}

export type TokenCreateDraft = {
  title: string;
  description: string;
  outcomes: string[];
  resolutionSources: { label: string; url: string }[];
  tokenMarket: TokenMarketConfig;
  coverImageUrl: string;
  slug: string;
  previewTokenStats?: (TokenLiveStats | null)[];
};

type Props = {
  stakeEndAt: string;
  resolveAfterAt: string;
  slug: string;
  questionType: TokenQuestionType;
  onQuestionTypeChange: (type: TokenQuestionType) => void;
  onSlugChange: (slug: string, manual?: boolean) => void;
  onDraftChange: (draft: TokenCreateDraft | null) => void;
  onDuplicateBlock: (blocked: boolean) => void;
};

export function TokenMarketCreateSection({
  stakeEndAt,
  resolveAfterAt,
  slug,
  questionType,
  onQuestionTypeChange,
  onSlugChange,
  onDraftChange,
  onDuplicateBlock,
}: Props) {
  const [linkInputs, setLinkInputs] = useState<string[]>([""]);
  const [pairs, setPairs] = useState<(TokenPairRef | null)[]>([]);
  const [pairStats, setPairStats] = useState<(TokenLiveStats | null)[]>([]);
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [thresholdUsd, setThresholdUsd] = useState("100000");
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);
  const questionMenuRef = useRef<HTMLDivElement>(null);

  const qDef = getTokenQuestionDef(isTokenQuestionType(questionType) ? questionType : "mcap_usd_above");
  const isComparison = qDef.mode === "comparison";

  useEffect(() => {
    if (!questionMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!questionMenuRef.current?.contains(e.target as Node)) setQuestionMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [questionMenuOpen]);

  useEffect(() => {
    if (isComparison && linkInputs.length < 2) setLinkInputs(["", ""]);
    if (!isComparison && linkInputs.length !== 1) {
      setLinkInputs([linkInputs[0] ?? ""]);
      setPairs([pairs[0] ?? null]);
      setPairStats([pairStats[0] ?? null]);
    }
  }, [isComparison]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolvedPairs = useMemo(() => pairs.filter((t): t is TokenPairRef => t !== null), [pairs]);
  const resolveAfterUnix = useMemo(() => Math.floor(parseLocalDateTimeToMs(resolveAfterAt) / 1000), [resolveAfterAt]);
  const stakeEndUnix = useMemo(() => Math.floor(parseLocalDateTimeToMs(stakeEndAt) / 1000), [stakeEndAt]);

  useEffect(() => {
    const keys = resolvedPairs.map((t) => `${t.chainSlug}:${t.pairAddress}`);
    if (new Set(keys).size !== keys.length) {
      setQuestionError("Each pair link must be unique.");
      return;
    }
    if (qDef.requiresMcapParity && resolvedPairs.length >= 2) {
      const parityErr = validateMcapParity(pairStats);
      if (parityErr) {
        setQuestionError(parityErr);
        return;
      }
    }
    setQuestionError(validateTokenResolveAfter(questionType, resolveAfterUnix) ?? "");
  }, [resolvedPairs, pairStats, questionType, qDef, resolveAfterUnix]);

  const fetchPair = useCallback(
    async (idx: number, raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setFetchError("Paste a Dexscreener or GeckoTerminal pool link.");
        return;
      }
      setLoadingIdx(idx);
      setFetchError("");
      try {
        const res = await fetch(`/api/token-pair?url=${encodeURIComponent(trimmed)}`);
        const json = (await res.json()) as { pair?: TokenPairRef; stats?: TokenLiveStats; error?: string };
        if (!res.ok || !json.pair) throw new Error(json.error ?? "Pair not found");
        setPairs((prev) => {
          const next = [...prev];
          next[idx] = json.pair!;
          return next;
        });
        setPairStats((prev) => {
          const next = [...prev];
          next[idx] = json.stats ?? null;
          return next;
        });
        if (idx === 0 && json.stats && qDef.needsThreshold === "usd") {
          setThresholdUsd(defaultUsdThreshold(json.stats));
        }
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Could not load pair");
        setPairs((prev) => {
          const next = [...prev];
          next[idx] = null;
          return next;
        });
        setPairStats((prev) => {
          const next = [...prev];
          next[idx] = null;
          return next;
        });
      } finally {
        setLoadingIdx(null);
      }
    },
    [qDef.needsThreshold],
  );

  const title = useMemo(() => {
    if (!resolvedPairs.length) return "";
    return buildTokenTitle(
      questionType,
      resolvedPairs,
      { thresholdUsd: qDef.needsThreshold === "usd" ? thresholdUsd : undefined },
      formatResolveLabel(resolveAfterAt),
    );
  }, [questionType, resolvedPairs, thresholdUsd, resolveAfterAt, qDef]);

  useEffect(() => {
    if (title && !slug) onSlugChange(slugify(title));
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onDuplicateBlock(false);
    if (resolvedPairs.length < qDef.minTokens || !resolveAfterUnix || !stakeEndUnix || questionError) {
      onDraftChange(null);
      return;
    }
    const tokenMarket = buildTokenMarketConfig({
      questionType,
      pairs: resolvedPairs,
      resolveAfterUnix,
      stakeEndUnix,
      thresholdUsd: qDef.needsThreshold === "usd" ? thresholdUsd : undefined,
    });
    onDraftChange({
      title,
      description: `Resolved by the operator from ${resolvedPairs[0]!.source === "geckoterminal" ? "GeckoTerminal" : "Dexscreener"} at resolve time.`,
      outcomes: buildTokenOutcomes(questionType, resolvedPairs),
      resolutionSources: buildTokenResolutionSources(resolvedPairs),
      tokenMarket,
      coverImageUrl: resolvedPairs[0]!.imageUri,
      slug: slug || slugify(title),
      previewTokenStats: resolvedPairs.map((t) => {
        const i = pairs.findIndex((x) => x?.pairAddress === t.pairAddress);
        return i >= 0 ? pairStats[i] ?? null : null;
      }),
    });
  }, [
    resolvedPairs,
    questionType,
    thresholdUsd,
    resolveAfterUnix,
    stakeEndUnix,
    title,
    slug,
    qDef,
    questionError,
    pairStats,
    pairs,
    onDraftChange,
    onDuplicateBlock,
  ]);

  const range = usdThresholdSliderRange(pairStats[0]);

  return (
    <div className="space-y-0 divide-y divide-[var(--border)]">
      <section className="py-8">
        <p className={labelClass}>Question type</p>
        <div ref={questionMenuRef} className="relative mt-3 max-w-md">
          <button type="button" onClick={() => setQuestionMenuOpen((o) => !o)} className={glassSelectTriggerClass}>
            <span>{qDef.label}</span>
            <CaretDown size={14} weight="bold" className={`shrink-0 text-[var(--muted)] ${questionMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {questionMenuOpen && (
            <ul className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-[var(--elevated-card-shadow)]">
              {TOKEN_QUESTION_GROUPS.map((group) => (
                <li key={group.id}>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{group.label}</p>
                  <ul>
                    {group.questions.map((q) => (
                      <li key={q.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onQuestionTypeChange(q.id);
                            setQuestionMenuOpen(false);
                          }}
                          className="w-full px-3 py-2.5 text-left text-sm hover:bg-[var(--surface-hover)]"
                        >
                          {q.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-2 max-w-lg text-xs leading-relaxed text-[var(--muted)]">
          {qDef.description} Paste a Dexscreener or GeckoTerminal pool link. The operator resolves from that page at resolve time.
        </p>
      </section>

      <section className="py-8">
        <p className={labelClass}>{isComparison ? "Pool links (2–4)" : "Pool link"}</p>
        <div className="mt-3 space-y-6">
          {linkInputs.map((val, idx) => (
            <div key={idx} className="space-y-1.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className={`relative ${glassInputClass} pr-9`}>
                  <input
                    className="w-full bg-transparent pr-1 font-mono text-[11px] outline-none"
                    placeholder="https://dexscreener.com/… or https://www.geckoterminal.com/…/pools/…"
                    value={val}
                    onChange={(e) => {
                      const next = [...linkInputs];
                      next[idx] = e.target.value;
                      setLinkInputs(next);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void fetchPair(idx, val);
                      }
                    }}
                  />
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => void fetchPair(idx, val)}
                    className="absolute inset-y-0 right-2.5 flex cursor-pointer items-center text-[var(--muted)] hover:text-emerald-400"
                  >
                    {loadingIdx === idx ? <CircleNotch size={16} className="animate-spin" /> : <Check size={16} weight="bold" />}
                  </span>
                </div>
                {pairs[idx]?.imageUri ? (
                  <img src={pairs[idx]!.imageUri} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                ) : null}
                {isComparison && linkInputs.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setLinkInputs((p) => p.filter((_, i) => i !== idx));
                      setPairs((p) => p.filter((_, i) => i !== idx));
                      setPairStats((p) => p.filter((_, i) => i !== idx));
                    }}
                  >
                    <Trash size={18} />
                  </button>
                ) : null}
              </div>
              {pairs[idx] ? (
                <p className="text-sm text-[var(--muted)]">
                  <span className="font-semibold text-[var(--foreground)]">${pairs[idx]!.symbol}</span>
                  {" · "}
                  {formatPriceUsd(pairStats[idx]?.priceUsd ?? null)}
                  {" · "}
                  {formatMcapUsd(pairStats[idx]?.marketCapUsd ?? null)} mcap
                  {" · "}
                  {pairs[idx]!.chainSlug} / {pairs[idx]!.quoteSymbol}
                </p>
              ) : null}
            </div>
          ))}
          {isComparison && linkInputs.length < 4 ? (
            <button
              type="button"
              onClick={() => {
                setLinkInputs((p) => [...p, ""]);
                setPairs((p) => [...p, null]);
                setPairStats((p) => [...p, null]);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              <Plus size={14} /> Add pair ({linkInputs.length}/4)
            </button>
          ) : null}
        </div>
        {fetchError ? <p className="mt-2 text-xs text-amber-400">{fetchError}</p> : null}
        {questionError ? <p className="mt-2 text-xs text-rose-400">{questionError}</p> : null}
      </section>

      {qDef.needsThreshold === "usd" ? (
        <section className="py-8">
          <label className={labelClass}>
            {questionType === "price_usd_above" ? "Price threshold (USD)" : "Market cap threshold (USD)"}
          </label>
          <div className="mt-3 max-w-xs space-y-3">
            <ThresholdSlider
              min={range.min}
              max={range.max}
              step={range.step}
              value={Math.min(range.max, Math.max(range.min, Number(String(thresholdUsd).replace(/,/g, "")) || range.min))}
              onChange={(n) => setThresholdUsd(formatUsdThresholdValue(n))}
              label="Threshold"
            />
            <input className={fieldClass} value={thresholdUsd} onChange={(e) => setThresholdUsd(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
        </section>
      ) : null}

      <section className="py-8">
        <p className={labelClass}>Generated title</p>
        <p className={fieldClass}>{title || "—"}</p>
      </section>
    </div>
  );
}

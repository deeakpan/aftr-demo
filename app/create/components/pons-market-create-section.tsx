"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import { CaretDown, Check, CircleNotch, Plus, Trash, Warning } from "@phosphor-icons/react";
import { getAddress, isAddress } from "viem";
import type { PonsQuestionType, PonsTokenRef, PonsMarketConfig } from "@/lib/pons/types";
import { PONS_QUESTION_GROUPS, getPonsQuestionDef, isPonsQuestionType, validatePonsResolveAfter } from "@/lib/pons/question-types";
import { knownPonsInfraLabel, PONS_MIN_DEX_LIQUIDITY_ETH } from "@/lib/pons/config";
import {
  buildPonsMarketConfig,
  buildPonsOutcomes,
  buildPonsResolutionSources,
  buildPonsTitle,
} from "@/lib/pons/metadata";
import {
  defaultUsdThreshold,
  formatPonsMcapUsd,
  formatPonsPriceUsd,
  formatUsdThresholdValue,
  usdThresholdSliderRange,
  validateMcapParity,
} from "@/lib/pons/market-stats";
import type { PonsLiveStats } from "@/lib/pons/types";

const PONS_CA_EXAMPLE = "0x1d5aAD3c0D6066078eA60F384a2492a550dB30b0";

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] sm:text-sm";

const glassInputClass =
  "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md outline-none transition placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)]/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-[var(--accent)]/20 sm:max-w-sm [html[data-theme=light]_&]:border-black/[0.08] [html[data-theme=light]_&]:bg-white/60";

const glassSelectTriggerClass =
  "flex w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md outline-none transition hover:border-white/15 focus:border-[var(--accent)]/50 focus:ring-2 focus:ring-[var(--accent)]/20 sm:max-w-md [html[data-theme=light]_&]:border-black/[0.08] [html[data-theme=light]_&]:bg-white/60";

const labelClass = "text-xs font-semibold uppercase tracking-wider text-[var(--muted)]";

const HEAT_GRADIENT =
  "linear-gradient(to right, #38bdf8 0%, #22d3ee 28%, #facc15 52%, #f97316 78%, #ef4444 100%)";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function heatRgb(pct: number): string {
  const t = Math.max(0, Math.min(1, pct / 100));
  const stops: [number, [number, number, number]][] = [
    [0, [56, 189, 248]],
    [0.28, [34, 211, 238]],
    [0.52, [250, 204, 21]],
    [0.78, [249, 115, 22]],
    [1, [239, 68, 68]],
  ];
  let i = 0;
  while (i < stops.length - 1 && t > stops[i + 1][0]) i += 1;
  const [t0, c0] = stops[i]!;
  const [t1, c1] = stops[Math.min(i + 1, stops.length - 1)]!;
  const u = (t - t0) / Math.max(0.0001, t1 - t0);
  return `rgb(${Math.round(lerp(c0[0], c1[0], u))} ${Math.round(lerp(c0[1], c1[1], u))} ${Math.round(lerp(c0[2], c1[2], u))})`;
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
  const heat = heatRgb(pct);

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
        if (next === clamped) return;
        onChange(next);
      }}
      aria-label={label}
      className="relative flex h-7 w-52 touch-none items-center select-none"
    >
      <Slider.Track className="relative h-2.5 w-full grow cursor-pointer">
        <span
          className="absolute inset-0 overflow-hidden [clip-path:polygon(0%_38%,100%_4%,100%_96%,0%_62%)]"
          style={{ background: HEAT_GRADIENT }}
        >
          <span
            className="absolute inset-y-0 right-0 bg-black/55"
            style={{ width: `${Math.max(0, 100 - pct)}%` }}
          />
        </span>
      </Slider.Track>
      <Slider.Thumb
        className="block size-5 cursor-grab rounded-full border-2 bg-white outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-white/70 active:cursor-grabbing active:scale-95"
        style={{
          borderColor: heat,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${heat} 35%, transparent), 0 1px 4px rgba(0,0,0,0.4)`,
        }}
      />
    </Slider.Root>
  );
}

export type PonsCreateDraft = {
  title: string;
  description: string;
  outcomes: string[];
  resolutionSources: { label: string; url: string }[];
  ponsMarket: PonsMarketConfig;
  coverImageUrl: string;
  slug: string;
  previewTokenStats?: (PonsLiveStats | null)[];
};

type Props = {
  stakeEndAt: string;
  resolveAfterAt: string;
  slug: string;
  questionType: PonsQuestionType;
  onQuestionTypeChange: (type: PonsQuestionType) => void;
  onSlugChange: (slug: string, manual?: boolean) => void;
  onDraftChange: (draft: PonsCreateDraft | null) => void;
  onDuplicateBlock: (blocked: boolean) => void;
};

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

function PonsTokenStatsLine({ token, stats }: { token: PonsTokenRef; stats: PonsLiveStats | null }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-snug text-[var(--muted)]">
      <span className="font-semibold text-[var(--foreground)]">${token.symbol}</span>
      <span aria-hidden className="text-[var(--border)]">·</span>
      <span className="tabular-nums">{formatPonsPriceUsd(stats?.priceUsd ?? null)}</span>
      <span aria-hidden className="text-[var(--border)]">·</span>
      <span>
        <span className="tabular-nums">{formatPonsMcapUsd(stats?.marketCapUsd ?? null)}</span> mcap
      </span>
      <span aria-hidden className="text-[var(--border)]">·</span>
      <span>
        <span className="tabular-nums">{stats?.liquidityEth != null ? `${stats.liquidityEth.toFixed(2)} ETH` : "—"}</span> liq
      </span>
      <span aria-hidden className="text-[var(--border)]">·</span>
      <span className="text-[var(--foreground)]">Uniswap v4</span>
    </p>
  );
}

export function PonsMarketCreateSection({
  stakeEndAt,
  resolveAfterAt,
  slug,
  questionType,
  onQuestionTypeChange,
  onSlugChange,
  onDraftChange,
  onDuplicateBlock,
}: Props) {
  const [tokenInputs, setTokenInputs] = useState<string[]>(["", ""]);
  const [tokens, setTokens] = useState<(PonsTokenRef | null)[]>([]);
  const [tokenStats, setTokenStats] = useState<(PonsLiveStats | null)[]>([]);
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [thresholdUsd, setThresholdUsd] = useState("100000");
  const [description, setDescription] = useState("");
  const [duplicateCheck, setDuplicateCheck] = useState<{
    loading: boolean;
    hits: { marketAddress: string; title: string }[];
  }>({ loading: false, hits: [] });
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);
  const questionMenuRef = useRef<HTMLDivElement>(null);

  const qDef = getPonsQuestionDef(isPonsQuestionType(questionType) ? questionType : "mcap_usd_above");
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
    if (isComparison && tokenInputs.length < 2) setTokenInputs(["", ""]);
    if (!isComparison && tokenInputs.length !== 1) {
      setTokenInputs([tokenInputs[0] ?? ""]);
      setTokens([tokens[0] ?? null]);
      setTokenStats([tokenStats[0] ?? null]);
    }
  }, [isComparison]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolvedTokens = useMemo(
    () => tokens.filter((t): t is PonsTokenRef => t !== null),
    [tokens],
  );

  const resolveAfterUnix = useMemo(
    () => Math.floor(parseLocalDateTimeToMs(resolveAfterAt) / 1000),
    [resolveAfterAt],
  );
  const stakeEndUnix = useMemo(
    () => Math.floor(parseLocalDateTimeToMs(stakeEndAt) / 1000),
    [stakeEndAt],
  );

  const questionValidationError = useMemo(() => {
    const addrs = resolvedTokens.map((t) => t.address.toLowerCase());
    if (new Set(addrs).size !== addrs.length) {
      return "Each token address must be unique — remove duplicate entries.";
    }

    if (qDef.requiresMcapParity && resolvedTokens.length >= 2) {
      const parityErr = validateMcapParity(tokenStats);
      if (parityErr) return parityErr;
    }

    const resolveErr = validatePonsResolveAfter(questionType, resolveAfterUnix);
    if (resolveErr) return resolveErr;

    return null;
  }, [tokens, tokenStats, questionType, qDef, resolvedTokens.length, resolveAfterUnix]);

  useEffect(() => {
    setQuestionError(questionValidationError ?? "");
  }, [questionValidationError]);

  const applyDefaultsForQuestion = useCallback(
    (nextType: PonsQuestionType, stats?: PonsLiveStats | null) => {
      const live = stats ?? tokenStats[0];
      const def = getPonsQuestionDef(nextType);
      if (def.needsThreshold === "usd") setThresholdUsd(defaultUsdThreshold(live));
    },
    [tokenStats],
  );

  const selectQuestionType = useCallback(
    (nextType: PonsQuestionType) => {
      const nextDef = getPonsQuestionDef(nextType);
      const wasComparison = isComparison;
      onQuestionTypeChange(nextType);
      setQuestionMenuOpen(false);
      setQuestionError("");
      setFetchError("");
      applyDefaultsForQuestion(nextType);
      if (nextDef.mode === "comparison" && !wasComparison) {
        setTokenInputs([tokenInputs[0] ?? "", ""]);
        setTokens([tokens[0] ?? null, null]);
        setTokenStats([tokenStats[0] ?? null, null]);
      } else if (nextDef.mode === "binary" && wasComparison) {
        setTokenInputs([tokenInputs[0] ?? ""]);
        setTokens([tokens[0] ?? null]);
        setTokenStats([tokenStats[0] ?? null]);
      }
    },
    [applyDefaultsForQuestion, isComparison, onQuestionTypeChange, tokenInputs, tokens, tokenStats],
  );

  const fetchToken = useCallback(
    async (idx: number, raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || !isAddress(trimmed)) {
        setFetchError("Enter a valid token contract address.");
        return;
      }
      const addr = getAddress(trimmed);
      const infra = knownPonsInfraLabel(addr);
      if (infra) {
        setFetchError(`${infra} is not a Pons launch token.`);
        setTokens((prev) => {
          const next = [...prev];
          next[idx] = null;
          return next;
        });
        return;
      }
      setLoadingIdx(idx);
      setFetchError("");
      try {
        const res = await fetch(`/api/pons/token/${addr}`);
        const json = (await res.json()) as {
          token?: PonsTokenRef;
          stats?: PonsLiveStats;
          description?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "Token not found on Pons");

        setTokens((prev) => {
          const next = [...prev];
          next[idx] = json.token!;
          return next;
        });
        setTokenStats((prev) => {
          const next = [...prev];
          next[idx] = json.stats ?? null;
          return next;
        });
        if (idx === 0 && json.description && !description) setDescription(json.description);
        if (idx === 0) applyDefaultsForQuestion(questionType, json.stats ?? null);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Could not load token");
        setTokens((prev) => {
          const next = [...prev];
          next[idx] = null;
          return next;
        });
        setTokenStats((prev) => {
          const next = [...prev];
          next[idx] = null;
          return next;
        });
      } finally {
        setLoadingIdx(null);
      }
    },
    [questionType, applyDefaultsForQuestion, description],
  );

  const primaryStats = tokenStats[0];
  const range = usdThresholdSliderRange(primaryStats);

  const title = useMemo(() => {
    if (!resolvedTokens.length) return "";
    return buildPonsTitle(
      questionType,
      resolvedTokens,
      {
        thresholdUsd: qDef.needsThreshold === "usd" ? thresholdUsd : undefined,
      },
      formatResolveLabel(resolveAfterAt),
    );
  }, [questionType, resolvedTokens, thresholdUsd, resolveAfterAt, qDef]);

  useEffect(() => {
    if (title && !slug) onSlugChange(slugify(title));
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const addrs = resolvedTokens.map((t) => t.address);
    if (!addrs.length || !resolveAfterUnix) {
      setDuplicateCheck({ loading: false, hits: [] });
      onDuplicateBlock(false);
      return;
    }

    let cancelled = false;
    setDuplicateCheck((p) => ({ ...p, loading: true }));
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/pons/check-duplicate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              questionType,
              tokenAddresses: addrs,
              resolveAfterUnix,
              ...(qDef.needsThreshold === "usd" ? { thresholdUsd } : {}),
            }),
          });
          const json = (await res.json()) as { duplicates?: { marketAddress: string; title: string }[] };
          if (cancelled) return;
          const hits = json.duplicates ?? [];
          setDuplicateCheck({ loading: false, hits });
          onDuplicateBlock(hits.length > 0);
        } catch {
          if (!cancelled) {
            setDuplicateCheck({ loading: false, hits: [] });
            onDuplicateBlock(false);
          }
        }
      })();
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [questionType, resolvedTokens, resolveAfterUnix, thresholdUsd, qDef, onDuplicateBlock]);

  useEffect(() => {
    let cancelled = false;
    if (
      resolvedTokens.length < qDef.minTokens ||
      !resolveAfterUnix ||
      !stakeEndUnix ||
      duplicateCheck.hits.length > 0 ||
      questionValidationError
    ) {
      queueMicrotask(() => {
        if (!cancelled) onDraftChange(null);
      });
      return () => {
        cancelled = true;
      };
    }

    const ponsMarket = buildPonsMarketConfig({
      questionType,
      tokens: resolvedTokens,
      resolveAfterUnix,
      stakeEndUnix,
      thresholdUsd: qDef.needsThreshold === "usd" ? thresholdUsd : undefined,
    });

    const draft = {
      title,
      description:
        description.trim() ||
        `Pons Uniswap v4 ${qDef.label} market. Resolved from on-chain pool price at resolve time.`,
      outcomes: buildPonsOutcomes(questionType, resolvedTokens),
      resolutionSources: buildPonsResolutionSources(resolvedTokens),
      ponsMarket,
      coverImageUrl: resolvedTokens[0]!.imageUri,
      slug: slug || slugify(title),
      previewTokenStats: resolvedTokens.map((t) => {
        const i = tokens.findIndex((x) => x?.address === t.address);
        return i >= 0 ? tokenStats[i] ?? null : null;
      }),
    };

    queueMicrotask(() => {
      if (!cancelled) onDraftChange(draft);
    });
    return () => {
      cancelled = true;
    };
  }, [
    resolvedTokens,
    questionType,
    thresholdUsd,
    resolveAfterUnix,
    stakeEndUnix,
    title,
    description,
    slug,
    duplicateCheck.hits.length,
    qDef,
    questionValidationError,
    tokenStats,
    tokens,
    onDraftChange,
  ]);

  return (
    <div className="space-y-0 divide-y divide-[var(--border)]">
      <section className="py-8">
        <p className={labelClass}>Question type</p>
        <div ref={questionMenuRef} className="relative mt-3 max-w-md">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={questionMenuOpen}
            onClick={() => setQuestionMenuOpen((o) => !o)}
            className={glassSelectTriggerClass}
          >
            <span>{qDef.label}</span>
            <CaretDown
              size={14}
              weight="bold"
              className={`shrink-0 text-[var(--muted)] transition ${questionMenuOpen ? "rotate-180" : ""}`}
            />
          </button>
          {questionMenuOpen && (
            <ul
              role="listbox"
              className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-[var(--elevated-card-shadow)]"
            >
              {PONS_QUESTION_GROUPS.map((group, groupIdx) => (
                <li key={group.id}>
                  {groupIdx > 0 ? <div className="mx-3 my-1 border-t border-[var(--border)]" aria-hidden /> : null}
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
          )}
        </div>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-[var(--muted)]">{qDef.description}</p>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-[var(--muted)]">
          Paste the CA of a Bonded token from Ponsfamily
        </p>
      </section>

      <section className="py-8">
        <p className={labelClass}>Token {isComparison ? "addresses (2–4)" : "contract address"}</p>
        <div className="mt-3 space-y-6">
          {tokenInputs.map((val, idx) => (
            <div key={idx} className="space-y-1.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className={`relative ${glassInputClass} pr-9`}>
                  <input
                    className="w-full bg-transparent pr-1 font-mono text-[11px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]/60"
                    placeholder={PONS_CA_EXAMPLE}
                    value={val}
                    onChange={(e) => {
                      const next = [...tokenInputs];
                      next[idx] = e.target.value;
                      setTokenInputs(next);
                      setTokens((prev) => {
                        const copy = [...prev];
                        copy[idx] = null;
                        return copy;
                      });
                      setTokenStats((prev) => {
                        const copy = [...prev];
                        copy[idx] = null;
                        return copy;
                      });
                      setFetchError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void fetchToken(idx, val);
                      }
                    }}
                  />
                  <span
                    role="button"
                    tabIndex={val.trim() && loadingIdx !== idx ? 0 : -1}
                    aria-label="Confirm token address"
                    onClick={() => {
                      if (!val.trim() || loadingIdx === idx) return;
                      void fetchToken(idx, val);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (!val.trim() || loadingIdx === idx) return;
                        void fetchToken(idx, val);
                      }
                    }}
                    className={`absolute inset-y-0 right-2.5 flex items-center ${
                      !val.trim() || loadingIdx === idx
                        ? "cursor-default text-[var(--muted)]/40"
                        : "cursor-pointer text-[var(--muted)] hover:text-emerald-400"
                    }`}
                  >
                    {loadingIdx === idx ? (
                      <CircleNotch size={16} className="animate-spin" />
                    ) : (
                      <Check size={16} weight="bold" />
                    )}
                  </span>
                </div>
                {tokens[idx]?.imageUri ? (
                  <img
                    src={tokens[idx]!.imageUri}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                  />
                ) : null}
                {isComparison && tokenInputs.length > 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      setTokenInputs((p) => p.filter((_, i) => i !== idx));
                      setTokens((p) => p.filter((_, i) => i !== idx));
                      setTokenStats((p) => p.filter((_, i) => i !== idx));
                    }}
                  >
                    <Trash size={18} />
                  </button>
                )}
              </div>
              {tokens[idx] ? <PonsTokenStatsLine token={tokens[idx]!} stats={tokenStats[idx]} /> : null}
            </div>
          ))}
          {isComparison && tokenInputs.length < 4 && (
            <button
              type="button"
              onClick={() => {
                setTokenInputs((p) => [...p, ""]);
                setTokens((p) => [...p, null]);
                setTokenStats((p) => [...p, null]);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--foreground)] transition hover:underline"
            >
              <Plus size={14} /> Add token ({tokenInputs.length}/4)
            </button>
          )}
        </div>
        {fetchError ? (
          <p className="mt-2 text-xs leading-relaxed text-amber-400">
            {fetchError.includes(`${PONS_MIN_DEX_LIQUIDITY_ETH} ETH`) || /invalid/i.test(fetchError)
              ? fetchError
              : `${fetchError} Need more than ${PONS_MIN_DEX_LIQUIDITY_ETH} ETH of DEX liquidity.`}
          </p>
        ) : null}
        {questionError && <p className="mt-2 text-xs text-rose-400">{questionError}</p>}
      </section>

      {qDef.needsThreshold === "usd" && (
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
              label={questionType === "price_usd_above" ? "Price threshold (USD)" : "Market cap threshold (USD)"}
            />
            <input
              className={fieldClass}
              value={thresholdUsd}
              onChange={(e) => setThresholdUsd(e.target.value.replace(/[^0-9.]/g, ""))}
            />
          </div>
        </section>
      )}

      <section className="py-8">
        <p className={labelClass}>Generated title</p>
        <p className={fieldClass}>{title || "—"}</p>
      </section>

      {(duplicateCheck.loading || duplicateCheck.hits.length > 0) && (
        <section className="py-4">
          {duplicateCheck.loading ? (
            <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <CircleNotch size={14} className="animate-spin" /> Checking duplicates…
            </p>
          ) : (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <Warning size={16} /> Duplicate open market (same question, token(s), resolve time)
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

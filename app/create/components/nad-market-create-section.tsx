"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, CircleNotch, Plus, Trash, Warning } from "@phosphor-icons/react";
import { getAddress, isAddress } from "viem";
import type { NadQuestionType, NadTokenRef, NadMarketConfig } from "@/lib/nad/types";
import { NAD_QUESTION_GROUPS, getQuestionDef } from "@/lib/nad/question-types";
import { knownNadInfraLabel } from "@/lib/nad/config";
import {
  buildNadMarketConfig,
  buildNadOutcomes,
  buildNadResolutionSources,
  buildNadTitle,
} from "@/lib/nad/metadata";
import {
  defaultHolderThreshold,
  defaultUsdThreshold,
  formatNadHolderCount,
  formatNadMcapUsd,
  formatNadPriceUsd,
  formatUsdThresholdValue,
  parseNadMarketStats,
  questionRequiresBondingCurve,
  usdThresholdSliderRange,
  validateMcapParity,
  maxTokenMcap,
  validateTokenForQuestion,
  type NadLiveStats,
} from "@/lib/nad/market-stats";

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] sm:text-sm";

const glassInputClass =
  "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md outline-none transition placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)]/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-[var(--accent)]/20 sm:max-w-sm [html[data-theme=light]_&]:border-black/[0.08] [html[data-theme=light]_&]:bg-white/60 [html[data-theme=light]_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";

const glassSelectTriggerClass =
  "flex w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md outline-none transition hover:border-white/15 focus:border-[var(--accent)]/50 focus:ring-2 focus:ring-[var(--accent)]/20 sm:max-w-md [html[data-theme=light]_&]:border-black/[0.08] [html[data-theme=light]_&]:bg-white/60";

const labelClass = "text-xs font-semibold uppercase tracking-wider text-[var(--muted)]";

export type NadCreateDraft = {
  title: string;
  description: string;
  outcomes: string[];
  resolutionSources: { label: string; url: string }[];
  nadMarket: NadMarketConfig;
  coverImageUrl: string;
  slug: string;
};

type Props = {
  stakeEndAt: string;
  resolveAfterAt: string;
  slug: string;
  onSlugChange: (slug: string, manual?: boolean) => void;
  onDraftChange: (draft: NadCreateDraft | null) => void;
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

function NadTokenStatsLine({ token, stats }: { token: NadTokenRef; stats: NadLiveStats | null }) {
  const phase = stats?.isOnDex || token.isGraduated ? "DEX" : "Curve";
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-snug text-[var(--muted)]">
      <span className="font-semibold text-[var(--foreground)]">${token.symbol}</span>
      <span aria-hidden className="text-[var(--border)]">
        ·
      </span>
      <span className="tabular-nums">{formatNadPriceUsd(stats?.priceUsd ?? null)}</span>
      <span aria-hidden className="text-[var(--border)]">
        ·
      </span>
      <span>
        <span className="tabular-nums">{formatNadMcapUsd(stats?.marketCapUsd ?? null)}</span> mcap
      </span>
      <span aria-hidden className="text-[var(--border)]">
        ·
      </span>
      <span>
        <span className="tabular-nums">{formatNadHolderCount(stats?.holderCount ?? null)}</span> holders
      </span>
      <span aria-hidden className="text-[var(--border)]">
        ·
      </span>
      <span className={phase === "DEX" ? "text-[var(--accent)]" : ""}>{phase}</span>
    </p>
  );
}

function UsdThresholdControl({
  questionType,
  value,
  stats,
  allStats,
  onChange,
}: {
  questionType: "price_usd_above" | "mcap_usd_above" | "mcap_threshold_first";
  value: string;
  stats: NadLiveStats | null | undefined;
  allStats?: (NadLiveStats | null)[];
  onChange: (next: string) => void;
}) {
  const isTarget = questionType === "mcap_threshold_first";
  const range = usdThresholdSliderRange(questionType, stats, allStats);
  const num = Number(value);
  const floor = range?.min ?? null;
  const formatLive =
    questionType === "price_usd_above"
      ? formatNadPriceUsd(stats?.priceUsd ?? null)
      : formatNadMcapUsd(stats?.marketCapUsd ?? null);

  const clamp = (n: number) => {
    if (!range) return n;
    return Math.min(range.max, Math.max(range.min, n));
  };

  return (
    <div className="mt-2 space-y-3">
      {range && Number.isFinite(num) ? (
        <input
          type="range"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--border)] accent-[var(--accent)]"
          min={range.min}
          max={range.max}
          step={range.step}
          value={clamp(num)}
          onChange={(e) => onChange(formatUsdThresholdValue(Number(e.target.value)))}
        />
      ) : null}
      <input
        className={fieldClass}
        value={value}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9.]/g, "");
          const n = Number(cleaned);
          if (!cleaned) {
            onChange("");
            return;
          }
          if (Number.isFinite(n)) {
            onChange(formatUsdThresholdValue(clamp(n)));
            return;
          }
          onChange(cleaned);
        }}
      />
      {isTarget && floor != null ? (
        <p className="text-[11px] text-[var(--muted)]">
          Target must be above every token&apos;s current mcap (highest now{" "}
          {formatNadMcapUsd(maxTokenMcap(allStats ?? []))}).
        </p>
      ) : floor != null ? (
        <p className="text-[11px] text-[var(--muted)]">
          Current {questionType === "price_usd_above" ? "price" : "market cap"} is {formatLive}. Threshold
          cannot be lower.
        </p>
      ) : null}
    </div>
  );
}

export function NadMarketCreateSection({
  stakeEndAt,
  resolveAfterAt,
  slug,
  onSlugChange,
  onDraftChange,
  onDuplicateBlock,
}: Props) {
  const [questionType, setQuestionType] = useState<NadQuestionType>("graduate_by_date");
  const [tokenInputs, setTokenInputs] = useState<string[]>(["", ""]);
  const [tokens, setTokens] = useState<(NadTokenRef | null)[]>([]);
  const [tokenStats, setTokenStats] = useState<(NadLiveStats | null)[]>([]);
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [thresholdUsd, setThresholdUsd] = useState("10000");
  const [holderCount, setHolderCount] = useState("500");
  const [description, setDescription] = useState("");
  const [duplicateCheck, setDuplicateCheck] = useState<{
    loading: boolean;
    hits: { marketAddress: string; title: string }[];
  }>({ loading: false, hits: [] });
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);
  const questionMenuRef = useRef<HTMLDivElement>(null);

  const qDef = getQuestionDef(questionType);
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
    () => tokens.filter((t): t is NadTokenRef => t !== null),
    [tokens],
  );

  const questionValidationError = useMemo(() => {
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok) continue;
      const stats = tokenStats[i];
      const err = validateTokenForQuestion(
        questionType,
        tok.symbol,
        Boolean(tok.isGraduated),
        Boolean(stats?.isOnDex),
      );
      if (err) return err;
    }

    if (qDef.requiresMcapParity && resolvedTokens.length >= 2) {
      const parityErr = validateMcapParity(
        tokenStats,
        tokens.map((t) => t?.symbol),
      );
      if (parityErr) return parityErr;
    }

    if (questionType === "mcap_threshold_first") {
      const maxMcap = maxTokenMcap(tokenStats);
      const target = Number(thresholdUsd);
      if (maxMcap != null && Number.isFinite(target) && target > 0 && target <= maxMcap) {
        return `Target mcap must be above all tokens' current mcap (max ${formatNadMcapUsd(maxMcap)}).`;
      }
    }

    return null;
  }, [tokens, tokenStats, questionType, qDef.requiresMcapParity, resolvedTokens.length, thresholdUsd]);

  useEffect(() => {
    setQuestionError(questionValidationError ?? "");
  }, [questionValidationError]);

  const resolveAfterUnix = Math.floor(parseLocalDateTimeToMs(resolveAfterAt) / 1000);
  const stakeEndUnix = Math.floor(parseLocalDateTimeToMs(stakeEndAt) / 1000);

  const applyDefaultsForQuestion = useCallback(
    (nextType: NadQuestionType, stats?: NadLiveStats | null) => {
      const live = stats ?? tokenStats[0];
      const def = getQuestionDef(nextType);
      if (def.needsThreshold === "usd") {
        setThresholdUsd(defaultUsdThreshold(nextType, live));
      }
      if (def.needsThreshold === "count") {
        setHolderCount(defaultHolderThreshold(live));
      }
    },
    [tokenStats],
  );

  const selectQuestionType = useCallback(
    (nextType: NadQuestionType) => {
      const nextDef = getQuestionDef(nextType);
      const wasComparison = isComparison;

      setQuestionType(nextType);
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
    [applyDefaultsForQuestion, isComparison, tokenInputs, tokens, tokenStats],
  );

  const fetchToken = useCallback(async (idx: number, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || !isAddress(trimmed)) {
      setFetchError("Enter a valid token contract address.");
      return;
    }
    const addr = getAddress(trimmed);
    const infra = knownNadInfraLabel(addr);
    if (infra) {
      setFetchError(`${infra} is not a Nad.fun meme token.`);
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
      const res = await fetch(`/api/nad/token/${addr}`);
      const json = (await res.json()) as {
        token_info?: {
          token_id: string;
          name: string;
          symbol: string;
          image_uri: string;
          is_graduated: boolean;
        };
        market_info?: Record<string, unknown>;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Token not found on Nad.fun");

      const info = json.token_info!;
      const market = json.market_info ?? {};
      const stats = parseNadMarketStats(market, { isGraduated: info.is_graduated });
      const ref: NadTokenRef = {
        address: info.token_id,
        symbol: info.symbol,
        name: info.name,
        imageUri: info.image_uri,
        isGraduated: info.is_graduated || stats.isOnDex,
      };
      setTokens((prev) => {
        const next = [...prev];
        next[idx] = ref;
        return next;
      });
      setTokenStats((prev) => {
        const next = [...prev];
        next[idx] = stats;
        return next;
      });

      const qErr = validateTokenForQuestion(
        questionType,
        ref.symbol,
        ref.isGraduated ?? false,
        stats.isOnDex,
      );
      if (qErr) setQuestionError(qErr);

      if (idx === 0) {
        applyDefaultsForQuestion(questionType, stats);
      }
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
  }, [questionType, applyDefaultsForQuestion]);

  const primaryStats = tokenStats[0];

  const title = useMemo(() => {
    if (!resolvedTokens.length) return "";
    return buildNadTitle({
      questionType,
      tokens: resolvedTokens,
      params: {
        thresholdUsd: qDef.needsThreshold === "usd" ? thresholdUsd : undefined,
        holderCount: qDef.needsThreshold === "count" ? Number(holderCount) : undefined,
      },
      resolveAfterLabel: formatResolveLabel(resolveAfterAt),
    });
  }, [questionType, resolvedTokens, thresholdUsd, holderCount, resolveAfterAt, qDef]);

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
          const res = await fetch("/api/nad/check-duplicate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              questionType,
              tokenAddresses: addrs,
              resolveAfterUnix,
              ...(questionType === "mcap_threshold_first" ? { thresholdUsd } : {}),
            }),
          });
          const json = (await res.json()) as {
            duplicates?: { marketAddress: string; title: string }[];
          };
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
  }, [questionType, resolvedTokens, resolveAfterUnix, thresholdUsd, onDuplicateBlock]);

  useEffect(() => {
    if (
      resolvedTokens.length < qDef.minTokens ||
      !resolveAfterUnix ||
      !stakeEndUnix ||
      duplicateCheck.hits.length > 0 ||
      questionValidationError
    ) {
      onDraftChange(null);
      return;
    }

    const nadMarket = buildNadMarketConfig({
      questionType,
      tokens: resolvedTokens,
      params: {
        thresholdUsd: qDef.needsThreshold === "usd" ? thresholdUsd : undefined,
        holderCount: qDef.needsThreshold === "count" ? Number(holderCount) : undefined,
      },
      resolveAfterUnix,
      stakeEndUnix,
    });

    onDraftChange({
      title,
      description:
        description.trim() ||
        `Nad.fun ${qDef.label} market. Resolved from on-chain and live market data at resolve time.`,
      outcomes: buildNadOutcomes(questionType, resolvedTokens),
      resolutionSources: buildNadResolutionSources(questionType, resolvedTokens),
      nadMarket,
      coverImageUrl: resolvedTokens[0]!.imageUri,
      slug: slug || slugify(title),
    });
  }, [
    resolvedTokens,
    questionType,
    thresholdUsd,
    holderCount,
    resolveAfterUnix,
    stakeEndUnix,
    title,
    description,
    slug,
    duplicateCheck.hits.length,
    qDef,
    questionValidationError,
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
              {NAD_QUESTION_GROUPS.map((group, groupIdx) => (
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
                      const incompatible =
                        questionRequiresBondingCurve(q.id) &&
                        tokens.some((t, i) => {
                          if (!t) return false;
                          const stats = tokenStats[i];
                          return Boolean(t.isGraduated || stats?.isOnDex);
                        });
                      return (
                        <li key={q.id} role="option" aria-selected={selected}>
                          <button
                            type="button"
                            disabled={incompatible}
                            onClick={() => {
                              if (incompatible) return;
                              selectQuestionType(q.id);
                            }}
                            className={`w-full px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
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
      </section>

      <section className="py-8">
        <p className={labelClass}>Token {isComparison ? "addresses (2–4)" : "contract address"}</p>
        <div className="mt-3 space-y-6">
          {tokenInputs.map((val, idx) => (
            <div key={idx} className="space-y-1.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className={glassInputClass}
                  placeholder="Nad.fun token CA…"
                  value={val}
                  onChange={(e) => {
                    const next = [...tokenInputs];
                    next[idx] = e.target.value;
                    setTokenInputs(next);
                  }}
                  onBlur={() => void fetchToken(idx, val)}
                />
                {tokens[idx]?.imageUri ? (
                  <img src={tokens[idx]!.imageUri} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/10" />
                ) : loadingIdx === idx ? (
                  <CircleNotch size={20} className="shrink-0 animate-spin text-[var(--accent)]" />
                ) : null}
                {isComparison && tokenInputs.length > 2 && (
                  <button type="button" onClick={() => {
                    setTokenInputs((p) => p.filter((_, i) => i !== idx));
                    setTokens((p) => p.filter((_, i) => i !== idx));
                    setTokenStats((p) => p.filter((_, i) => i !== idx));
                  }}>
                    <Trash size={18} />
                  </button>
                )}
              </div>
              {tokens[idx] ? (
                <NadTokenStatsLine token={tokens[idx]!} stats={tokenStats[idx]} />
              ) : null}
            </div>
          ))}
          {isComparison && tokenInputs.length < 4 && (
            <button type="button" onClick={() => {
              setTokenInputs((p) => [...p, ""]);
              setTokens((p) => [...p, null]);
              setTokenStats((p) => [...p, null]);
            }} className="text-xs text-[var(--accent)]">
              + Add token ({tokenInputs.length}/4)
            </button>
          )}
        </div>
        {fetchError && <p className="mt-2 text-xs text-rose-400">{fetchError}</p>}
        {questionError && <p className="mt-2 text-xs text-rose-400">{questionError}</p>}
      </section>

      {qDef.needsThreshold === "usd" && (
        <section className="py-8">
          <label className={labelClass}>
            {questionType === "price_usd_above"
              ? "Price threshold (USD)"
              : questionType === "mcap_threshold_first"
                ? "Target market cap (USD)"
                : "Market cap threshold (USD)"}
          </label>
          <UsdThresholdControl
            questionType={
              questionType as "price_usd_above" | "mcap_usd_above" | "mcap_threshold_first"
            }
            value={thresholdUsd}
            stats={primaryStats}
            allStats={tokenStats}
            onChange={setThresholdUsd}
          />
        </section>
      )}

      {qDef.needsThreshold === "count" && (
        <section className="py-8">
          <label className={labelClass}>Minimum holder count</label>
          <input className={fieldClass} value={holderCount} onChange={(e) => setHolderCount(e.target.value.replace(/\D/g, ""))} />
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

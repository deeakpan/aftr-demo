"use client";

import { ArrowsClockwise, ChartBar, Flag } from "@phosphor-icons/react";
import { useMemo } from "react";
import type { NadMarketConfig } from "@/lib/nad/types";
import type { NadLiveStats } from "@/lib/nad/market-stats";
import { cardBackgroundFromSeed } from "@/lib/nad/metadata";
import { NadComparisonOutcomeRow } from "@/app/market/components/nad-comparison-outcome-row";
import { MarketShareButton } from "@/app/market/components/market-share-button";
import { useNadComparisonStats } from "@/app/market/hooks/use-nad-comparison-stats";
import {
  BinaryProbabilityPipe,
  binaryOutcomePillClass,
  MARKET_CARD_BODY_CLASS,
  MARKET_CARD_META_CLASS,
  MARKET_CARD_MULTI_LABEL_CLASS,
  MARKET_CARD_MULTI_PCT_CLASS,
  MARKET_CARD_MULTI_ROW_CLASS,
  MARKET_CARD_OUTCOMES_BOX,
  MARKET_CARD_SHELL_CLASS,
  MARKET_CARD_HOVER_CLASS,
  MARKET_CARD_TITLE_CLASS,
  MarketCloseDate,
} from "@/app/market/components/market-list-card";
import { MARKET_COVER_ASPECT_CLASS } from "@/lib/market-cover";

export type NadMarketListCardProps = {
  title: string;
  nadMarket: NadMarketConfig;
  outcomeLabels: string[];
  outcomeChancePcts?: number[];
  poolTvl?: string;
  resolveAfter?: string;
  resolveAfterTooltip?: string;
  showNewBadge?: boolean;
  onTitleClick?: () => void;
  onTrade?: (outcomeIndex: number) => void;
  onRefreshTvl?: () => void;
  tvlRefreshing?: boolean;
  interactive?: boolean;
  tradingClosed?: boolean;
  className?: string;
  /** Live mcap for preview (create flow); otherwise fetched on mount. */
  previewTokenStats?: (NadLiveStats | null)[];
  marketAddress?: string;
  slug?: string | null;
};

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function evenSplitPct(count: number, index: number) {
  if (count <= 0) return 0;
  const base = Math.floor(100 / count);
  return index === 0 ? 100 - base * (count - 1) : base;
}

export function nadTokenForOutcome(nad: NadMarketConfig, label: string, idx: number) {
  if (label.toUpperCase() === "NEITHER") return undefined;
  if (nad.mode === "comparison") {
    return nad.tokens[idx] ?? nad.tokens.find((t) => t.symbol.toUpperCase() === label.toUpperCase());
  }
  return nad.tokens[0];
}

export function nadOutcomeDisplayLabel(nad: NadMarketConfig, label: string) {
  if (nad.mode === "comparison" && label.toUpperCase() !== "NEITHER") return `$${label}`;
  return label;
}

function uniqueTokensForCover(tokens: NadMarketConfig["tokens"], max: number) {
  const seen = new Set<string>();
  const out: NadMarketConfig["tokens"] = [];
  for (const t of tokens) {
    const key = t.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function NadMarketCardCover({ nadMarket }: { nadMarket: NadMarketConfig }) {
  const bg = cardBackgroundFromSeed(nadMarket.cardBackgroundSeed);
  const headerTokens = uniqueTokensForCover(
    nadMarket.tokens,
    nadMarket.mode === "comparison" ? 4 : 1,
  );

  return (
    <div
      className={`${MARKET_COVER_ASPECT_CLASS} relative shrink-0 overflow-hidden`}
      style={{ background: bg }}
    >
      <div className="absolute inset-0 bg-black/25" />
      <div className="relative flex h-full flex-col items-center justify-center px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70">Pons</p>
        <div className="mt-2 flex items-center justify-center -space-x-3">
          {headerTokens.map((tok, i) => (
            <div
              key={`${tok.address.toLowerCase()}-${i}`}
              className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-white/90 bg-[var(--surface)] shadow-md md:h-14 md:w-14"
            >
              {tok.imageUri ? (
                <img src={tok.imageUri} alt={tok.symbol} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-bold text-[var(--muted)]">
                  {tok.symbol.slice(0, 2)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NadMarketListCard({
  title,
  nadMarket,
  outcomeLabels,
  outcomeChancePcts,
  poolTvl,
  resolveAfter,
  resolveAfterTooltip,
  showNewBadge = false,
  onTitleClick,
  onTrade,
  onRefreshTvl,
  tvlRefreshing = false,
  interactive = true,
  tradingClosed = false,
  className = "",
  previewTokenStats,
  marketAddress,
  slug,
}: NadMarketListCardProps) {
  const labels = outcomeLabels.filter((l) => l.trim()).slice(0, 4);
  const displayLabels = labels.length >= 2 ? labels : ["Yes", "No"];

  const showMcapButtons = nadMarket.mode === "comparison";

  const { stats: liveStats, loading: statsLoading } = useNadComparisonStats(
    nadMarket.tokens,
    showMcapButtons && previewTokenStats === undefined,
    previewTokenStats,
    nadMarket,
  );

  const mcapByAddress = useMemo(() => {
    const map = new Map<string, NadLiveStats | null>();
    nadMarket.tokens.forEach((t, i) => {
      map.set(t.address.toLowerCase(), liveStats[i] ?? null);
    });
    return map;
  }, [nadMarket.tokens, liveStats]);

  const pcts = displayLabels.map((_, idx) => {
    const raw = outcomeChancePcts?.[idx];
    return clampPct(Number.isFinite(raw) ? (raw as number) : evenSplitPct(displayLabels.length, idx));
  });

  const isBinary = nadMarket.mode === "binary";

  const showVolume =
    !showNewBadge && poolTvl !== undefined && poolTvl !== "" && poolTvl !== "0" && poolTvl !== "0.00";

  return (
    <article
      className={`${MARKET_CARD_SHELL_CLASS} transition duration-200 ${
        interactive
          ? MARKET_CARD_HOVER_CLASS
          : ""
      } ${className}`}
    >
      <NadMarketCardCover nadMarket={nadMarket} />

      <div className={MARKET_CARD_BODY_CLASS}>
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            className={`${MARKET_CARD_TITLE_CLASS} w-full text-left underline-offset-2 hover:underline`}
          >
            {title || "Untitled market"}
          </button>
        ) : (
          <p className={MARKET_CARD_TITLE_CLASS}>{title || "Untitled market"}</p>
        )}

        <p className={`${MARKET_CARD_META_CLASS} invisible`} aria-hidden>
          ·
        </p>

        {isBinary ? (
          <div className={`${MARKET_CARD_OUTCOMES_BOX} justify-center gap-2.5`}>
            <BinaryProbabilityPipe yesPct={pcts[0] ?? 50} noPct={pcts[1] ?? 50} />

            <div className="grid grid-cols-2 gap-2">
              {displayLabels.map((label, idx) => {
                const isNo = idx === 1;
                const text = nadOutcomeDisplayLabel(nadMarket, label);
                const btnClass = `flex min-h-[2.5rem] items-center justify-center rounded-xl px-2 py-2.5 text-center text-sm font-bold transition ${binaryOutcomePillClass(true, isNo, tradingClosed)}`;

                if (onTrade && interactive && !tradingClosed) {
                  return (
                    <button
                      key={`${label}-${idx}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTrade(idx);
                      }}
                      className={btnClass}
                    >
                      {text}
                    </button>
                  );
                }

                return (
                  <div key={`${label}-${idx}`} className={btnClass}>
                    {text}
                  </div>
                );
              })}
            </div>
          </div>
        ) : showMcapButtons ? (
          <div className={`${MARKET_CARD_OUTCOMES_BOX} no-scrollbar gap-0.5 overflow-y-auto`}>
            {displayLabels.map((label, idx) => {
              const tok = nadTokenForOutcome(nadMarket, label, idx);
              const mcap =
                label.toUpperCase() === "NEITHER" || !tok
                  ? null
                  : (mcapByAddress.get(tok.address.toLowerCase())?.marketCapUsd ?? null);

              return (
                <NadComparisonOutcomeRow
                  key={`${label}-${idx}`}
                  symbol={tok?.symbol ?? label}
                  imageUri={tok?.imageUri}
                  mcapUsd={mcap}
                  chancePct={pcts[idx] ?? 0}
                  loading={statsLoading && label.toUpperCase() !== "NEITHER"}
                  interactive={interactive}
                  tradingClosed={tradingClosed}
                  onClick={
                    onTrade && interactive && !tradingClosed ? () => onTrade(idx) : undefined
                  }
                />
              );
            })}
          </div>
        ) : (
          <div className={`${MARKET_CARD_OUTCOMES_BOX} no-scrollbar gap-0.5 overflow-x-hidden overflow-y-auto`}>
            {displayLabels.map((label, idx) => {
              const tok = nadTokenForOutcome(nadMarket, label, idx);
              const row = (
                <>
                  {tok?.imageUri ? (
                    <img
                      src={tok.imageUri}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
                    />
                  ) : null}
                  <span className={MARKET_CARD_MULTI_LABEL_CLASS}>{nadOutcomeDisplayLabel(nadMarket, label)}</span>
                  <span className={MARKET_CARD_MULTI_PCT_CLASS}>{Math.round(pcts[idx] ?? 0)}%</span>
                </>
              );

              if (onTrade && interactive && !tradingClosed) {
                return (
                  <button
                    key={`${label}-${idx}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrade(idx);
                    }}
                    className={`${MARKET_CARD_MULTI_ROW_CLASS} w-full cursor-pointer transition hover:bg-[var(--surface-hover)]`}
                  >
                    {row}
                  </button>
                );
              }

              return (
                <div key={`${label}-${idx}`} className={`${MARKET_CARD_MULTI_ROW_CLASS} opacity-80`}>
                  {row}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] text-[var(--muted)]">
        {showVolume ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--foreground)]">
            <ChartBar size={14} weight="bold" className="text-[var(--muted)]" />
            ${poolTvl}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-amber-400 [html[data-theme=light]_&]:text-amber-600">
            <Flag size={13} weight="fill" />
            New
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {marketAddress ? (
            <MarketShareButton address={marketAddress} slug={slug} title={title} iconSize={13} />
          ) : null}
          {onRefreshTvl && (
            <button
              type="button"
              aria-label="Refresh TVL"
              disabled={tvlRefreshing}
              onClick={(e) => {
                e.stopPropagation();
                onRefreshTvl();
              }}
              className="rounded p-0.5 transition hover:text-[var(--foreground)] disabled:opacity-40"
            >
              <ArrowsClockwise size={14} className={tvlRefreshing ? "animate-spin" : ""} />
            </button>
          )}
          {resolveAfter && (
            <MarketCloseDate label={resolveAfter} tooltip={resolveAfterTooltip} iconSize={13} />
          )}
          {tradingClosed && (
            <span className="inline-flex items-center gap-1 text-[var(--outcome-no)]">
              <Flag size={13} weight="fill" />
              Closed
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

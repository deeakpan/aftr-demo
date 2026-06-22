"use client";

import { ArrowsClockwise, ChartBar, Clock, Flag } from "@phosphor-icons/react";
import type { NadMarketConfig } from "@/lib/nad/types";
import { cardBackgroundFromSeed } from "@/lib/nad/metadata";
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
  MARKET_CARD_TITLE_CLASS,
} from "@/app/market/components/market-list-card";
import { MARKET_COVER_ASPECT_CLASS } from "@/lib/market-cover";

export type NadMarketListCardProps = {
  title: string;
  nadMarket: NadMarketConfig;
  outcomeLabels: string[];
  outcomeChancePcts?: number[];
  poolTvl?: string;
  resolveAfter?: string;
  showNewBadge?: boolean;
  onTitleClick?: () => void;
  onTrade?: (outcomeIndex: number) => void;
  onRefreshTvl?: () => void;
  tvlRefreshing?: boolean;
  interactive?: boolean;
  tradingClosed?: boolean;
  className?: string;
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

export function NadMarketCardCover({ nadMarket }: { nadMarket: NadMarketConfig }) {
  const bg = cardBackgroundFromSeed(nadMarket.cardBackgroundSeed);
  const headerTokens =
    nadMarket.mode === "comparison" ? nadMarket.tokens.slice(0, 4) : nadMarket.tokens.slice(0, 1);

  return (
    <div
      className={`${MARKET_COVER_ASPECT_CLASS} relative w-full shrink-0 overflow-hidden`}
      style={{ background: bg }}
    >
      <div className="absolute inset-0 bg-black/25" />
      <div className="relative flex h-full flex-col items-center justify-center px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70">Nad.fun</p>
        <div className="mt-2 flex items-center justify-center -space-x-3">
          {headerTokens.map((tok) => (
            <div
              key={tok.address}
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
  showNewBadge = false,
  onTitleClick,
  onTrade,
  onRefreshTvl,
  tvlRefreshing = false,
  interactive = true,
  tradingClosed = false,
  className = "",
}: NadMarketListCardProps) {
  const labels = outcomeLabels.filter((l) => l.trim()).slice(0, 4);
  const displayLabels = labels.length >= 2 ? labels : ["Yes", "No"];

  const pcts = displayLabels.map((_, idx) => {
    const raw = outcomeChancePcts?.[idx];
    return clampPct(Number.isFinite(raw) ? (raw as number) : evenSplitPct(displayLabels.length, idx));
  });

  const isBinary = displayLabels.length === 2;

  const showVolume =
    !showNewBadge && poolTvl !== undefined && poolTvl !== "" && poolTvl !== "0" && poolTvl !== "0.00";

  return (
    <article
      className={`${MARKET_CARD_SHELL_CLASS} transition duration-200 ${
        interactive
          ? "hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-[0_16px_40px_rgb(139_92_246_/_0.28)] [html[data-theme=light]_&]:hover:shadow-[0_16px_40px_rgb(124_77_255_/_0.14)]"
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
            <ChartBar size={14} weight="bold" className="text-[var(--accent)]" />
            ${poolTvl}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-amber-400 [html[data-theme=light]_&]:text-amber-600">
            <Flag size={13} weight="fill" />
            New
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
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
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Clock size={13} />
              {resolveAfter}
            </span>
          )}
          {tradingClosed && (
            <span className="inline-flex items-center gap-1 text-rose-400">
              <Flag size={13} weight="fill" />
              Closed
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

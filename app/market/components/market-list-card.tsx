"use client";

import { ArrowsClockwise, ChartBar, Clock, Flag } from "@phosphor-icons/react";
import { MARKET_COVER_ASPECT_CLASS } from "@/lib/market-cover";

export type MarketListCardProps = {
  title: string;
  imageUrl?: string;
  imageAlt?: string;
  outcomeLabels: string[];
  /** Implied probability % per outcome; defaults to even split. */
  outcomeChancePcts?: number[];
  /** Formatted TVL string without currency symbol (e.g. "5,490"). */
  poolTvl?: string;
  resolveAfter?: string;
  /** Show orange NEW badge instead of volume. */
  showNewBadge?: boolean;
  onTitleClick?: () => void;
  /** Called when user taps the trade button on an outcome row. */
  onTrade?: (outcomeIndex: number) => void;
  onRefreshTvl?: () => void;
  tvlRefreshing?: boolean;
  interactive?: boolean;
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

export function BinaryProbabilityPipe({ yesPct, noPct }: { yesPct: number; noPct: number }) {
  const yes = clampPct(yesPct);
  const no = clampPct(noPct);
  const yesFlex = Math.max(yes, 4);
  const noFlex = Math.max(no, 4);

  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums text-[var(--outcome-yes)]">
        {Math.round(yes)}%
      </span>
      <div className="flex h-[0.625rem] min-w-0 flex-1 items-stretch gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface)] p-px">
        <div
          className="min-w-[4px] rounded-full bg-[var(--outcome-yes)] transition-all duration-300"
          style={{ flex: yesFlex }}
        />
        <div
          className="min-w-[4px] rounded-full bg-[var(--outcome-no)] transition-all duration-300"
          style={{ flex: noFlex }}
        />
      </div>
      <span className="w-8 shrink-0 text-xs font-bold tabular-nums text-[var(--outcome-no)]">
        {Math.round(no)}%
      </span>
    </div>
  );
}

/** Shared binary outcome pill — rounded rect, matches trade panel on market detail. */
export function binaryOutcomePillClass(active: boolean, isNo: boolean) {
  if (active) {
    return isNo
      ? "bg-[var(--outcome-no)] text-white hover:bg-[var(--outcome-no-hover)]"
      : "bg-[var(--outcome-yes)] text-white hover:bg-[var(--outcome-yes-hover)]";
  }
  return "bg-[var(--surface)] text-[var(--muted)] ring-1 ring-[var(--border)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]";
}

export function MarketListCard({
  title,
  imageUrl,
  imageAlt,
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
  className = "",
}: MarketListCardProps) {
  const labels = outcomeLabels.filter((l) => l.trim()).slice(0, 8);
  const displayLabels =
    labels.length >= 2 ? labels : labels.length === 1 ? [labels[0]!, "Outcome 2"] : ["Yes", "No"];

  const pcts = displayLabels.map((_, idx) => {
    const raw = outcomeChancePcts?.[idx];
    return clampPct(Number.isFinite(raw) ? (raw as number) : evenSplitPct(displayLabels.length, idx));
  });

  const isBinary = displayLabels.length === 2;
  const showVolume =
    !showNewBadge && poolTvl !== undefined && poolTvl !== "" && poolTvl !== "0" && poolTvl !== "0.00";

  return (
    <article
      className={`flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--elevated-card-shadow)] transition duration-200 ${
        interactive
          ? "hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-[0_16px_40px_rgb(139_92_246_/_0.28)] [html[data-theme=light]_&]:hover:shadow-[0_16px_40px_rgb(124_77_255_/_0.14)]"
          : ""
      } ${className}`}
    >
      <div className={`${MARKET_COVER_ASPECT_CLASS} w-full shrink-0 overflow-hidden bg-[var(--surface)]`}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={imageAlt ?? title}
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--muted)]">
            No cover image
          </div>
        )}
      </div>

      <div className="flex min-h-[10.5rem] flex-1 flex-col px-3 pb-3 pt-3">
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            className="line-clamp-2 w-full shrink-0 text-left text-[13px] font-semibold leading-snug text-[var(--foreground)] underline-offset-2 hover:underline md:text-[15px]"
          >
            {title || "Untitled market"}
          </button>
        ) : (
          <p className="line-clamp-2 shrink-0 text-[13px] font-semibold leading-snug text-[var(--foreground)] md:text-[15px]">
            {title || "Untitled market"}
          </p>
        )}

        {isBinary ? (
          <div className="mt-4 flex flex-1 flex-col justify-between gap-3">
            <BinaryProbabilityPipe yesPct={pcts[0] ?? 50} noPct={pcts[1] ?? 50} />

            <div className="grid grid-cols-2 gap-2">
              {displayLabels.map((label, idx) => {
                const isNo = idx === 1;
                const btnClass = `flex items-center justify-center rounded-xl py-2.5 text-center text-sm font-bold transition ${binaryOutcomePillClass(true, isNo)}`;

                if (onTrade && interactive) {
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
                      {label}
                    </button>
                  );
                }

                return (
                  <div key={`${label}-${idx}`} className={btnClass}>
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="no-scrollbar mt-2.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {displayLabels.map((label, idx) => {
              const pct = pcts[idx] ?? 0;
              const rowContent = (
                <>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--foreground)]">
                    {label}
                  </span>
                  <span className="shrink-0 text-[12px] font-bold tabular-nums text-[var(--foreground)]">
                    {pct.toFixed(0)}%
                  </span>
                </>
              );

              if (onTrade && interactive) {
                return (
                  <button
                    key={`${label}-${idx}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrade(idx);
                    }}
                    className="flex min-h-[2.125rem] w-full items-center gap-2 rounded-lg px-0.5 py-0.5 text-left transition hover:bg-[var(--surface-hover)]"
                  >
                    {rowContent}
                  </button>
                );
              }

              return (
                <div
                  key={`${label}-${idx}`}
                  className="flex min-h-[2.125rem] items-center gap-2 rounded-lg px-0.5 py-0.5"
                >
                  {rowContent}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-auto flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--muted)]">
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

        <div className="flex items-center gap-2">
          {onRefreshTvl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRefreshTvl();
              }}
              className="inline-flex items-center transition hover:text-[var(--foreground)]"
              aria-label="Refresh volume"
            >
              <ArrowsClockwise size={12} className={tvlRefreshing ? "animate-spin" : ""} />
            </button>
          )}
          {resolveAfter && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock size={12} />
              {resolveAfter}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function MarketListCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <article
      className={`flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--elevated-card-shadow)] ${className}`}
    >
      <div className={`${MARKET_COVER_ASPECT_CLASS} w-full shrink-0 animate-pulse bg-[var(--border)]/50`} />
      <div className="flex min-h-[10.5rem] flex-1 flex-col px-3 py-3">
        <div className="h-4 w-full animate-pulse rounded bg-[var(--border)]/50" />
        <div className="mt-4 h-4 w-[70%] animate-pulse rounded bg-[var(--border)]/50" />
        <div className="mt-5 flex items-center gap-2">
          <div className="h-4 w-8 animate-pulse rounded bg-[var(--border)]/50" />
          <div className="h-8 flex-1 animate-pulse rounded-full bg-[var(--border)]/50" />
          <div className="h-4 w-8 animate-pulse rounded bg-[var(--border)]/50" />
        </div>
        <div className="mt-auto grid grid-cols-2 gap-2.5 pt-5">
          <div className="h-11 animate-pulse rounded-full bg-[var(--border)]/50" />
          <div className="h-11 animate-pulse rounded-full bg-[var(--border)]/50" />
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="h-3 w-12 animate-pulse rounded bg-[var(--border)]/50" />
        <div className="h-3 w-16 animate-pulse rounded bg-[var(--border)]/50" />
      </div>
    </article>
  );
}

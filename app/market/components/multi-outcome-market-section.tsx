"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { MarketTradeVolumeChart } from "@/app/market/components/market-trade-volume-chart";
import { outcomeColor } from "@/app/market/lib/outcome-colors";

export type OutcomeOrderBookSnapshot = {
  bidPrices: bigint[];
  bidVolumes: bigint[];
  askPrices: bigint[];
  askVolumes: bigint[];
};

type MultiOutcomeMarketSectionProps = {
  labels: string[];
  chancePcts: number[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  marketAddress: string;
  collateralDecimals: number;
  collateralTicker: string;
  marketState: number;
  obSnapshot: OutcomeOrderBookSnapshot | null;
};

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function OutcomeOrderBook({
  snapshot,
  collateralDecimals,
}: {
  snapshot: OutcomeOrderBookSnapshot | null;
  collateralDecimals: number;
}) {
  if (!snapshot || (snapshot.bidPrices.length === 0 && snapshot.askPrices.length === 0)) {
    return <p className="py-4 text-sm text-[var(--muted)]">No open orders for this outcome yet.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-500">Bids</p>
        <div className="space-y-1">
          {[...snapshot.bidPrices.map((p, i) => ({ p, v: snapshot.bidVolumes[i]! }))]
            .sort((a, b) => Number(b.p - a.p))
            .slice(0, 8)
            .map(({ p, v }, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md bg-emerald-500/5 px-2.5 py-1.5"
              >
                <span className="font-mono font-semibold text-emerald-400">
                  ${formatUnits(p, collateralDecimals)}
                </span>
                <span className="font-mono text-[var(--muted)]">
                  {Number(formatUnits(v, collateralDecimals)).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-500">Asks</p>
        <div className="space-y-1">
          {[...snapshot.askPrices.map((p, i) => ({ p, v: snapshot.askVolumes[i]! }))]
            .sort((a, b) => Number(a.p - b.p))
            .slice(0, 8)
            .map(({ p, v }, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md bg-rose-500/5 px-2.5 py-1.5"
              >
                <span className="font-mono font-semibold text-rose-400">
                  ${formatUnits(p, collateralDecimals)}
                </span>
                <span className="font-mono text-[var(--muted)]">
                  {Number(formatUnits(v, collateralDecimals)).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function OutcomeExpandPanel({
  tab,
  setTab,
  tradingOpen,
  marketAddress,
  collateralDecimals,
  collateralTicker,
  outcomeLabels,
  outcomeIndex,
  obSnapshot,
}: {
  tab: "activity" | "orderbook";
  setTab: (tab: "activity" | "orderbook") => void;
  tradingOpen: boolean;
  marketAddress: string;
  collateralDecimals: number;
  collateralTicker: string;
  outcomeLabels: string[];
  outcomeIndex: number;
  obSnapshot: OutcomeOrderBookSnapshot | null;
}) {
  return (
    <div className="bg-[var(--surface)]/40 px-3 pb-4 pt-3">
      <div className="mb-3 flex gap-5 text-[11px] font-medium uppercase tracking-wider">
        <button
          type="button"
          onClick={() => setTab("activity")}
          className={`transition ${
            tab === "activity"
              ? "text-[var(--foreground)]"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          Activity
        </button>
        {tradingOpen && (
          <button
            type="button"
            onClick={() => setTab("orderbook")}
            className={`transition ${
              tab === "orderbook"
                ? "text-[var(--foreground)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            Order book
          </button>
        )}
      </div>

      {tab === "activity" ? (
        <MarketTradeVolumeChart
          marketAddress={marketAddress}
          collateralDecimals={collateralDecimals}
          collateralTicker={collateralTicker}
          outcomeLabels={outcomeLabels}
          highlightOutcomeIndex={outcomeIndex}
          hideLegend
          height={280}
        />
      ) : (
        <OutcomeOrderBook snapshot={obSnapshot} collateralDecimals={collateralDecimals} />
      )}
    </div>
  );
}

export function MultiOutcomeMarketSection({
  labels,
  chancePcts,
  selectedIndex,
  onSelect,
  marketAddress,
  collateralDecimals,
  collateralTicker,
  marketState,
  obSnapshot,
}: MultiOutcomeMarketSectionProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<"activity" | "orderbook">("activity");
  const tradingOpen = marketState === 0;

  const pcts = labels.map((_, i) =>
    clampPct(chancePcts[i] ?? (i === 0 ? 50 : Math.round(50 / Math.max(1, labels.length - 1)))),
  );

  function handleRowClick(index: number) {
    onSelect(index);
    if (expandedIndex === index) {
      setExpandedIndex(null);
      return;
    }
    setExpandedIndex(index);
    setTab("activity");
  }

  return (
    <div className="mb-6">
      <div className="flex flex-col">
        {labels.map((label, i) => {
          const active = selectedIndex === i;
          const expanded = expandedIndex === i;
          const dot = outcomeColor(i);

          return (
            <div key={`${label}-${i}`} className="border-b border-[var(--border)] py-0.5 last:border-b-0">
              <button
                type="button"
                onClick={() => handleRowClick(i)}
                className={`flex w-full items-center gap-3 px-3 py-3.5 text-left transition ${
                  expanded
                    ? "rounded-xl border border-[var(--accent)] bg-[var(--surface-hover)]/40"
                    : "rounded-lg border border-transparent hover:bg-[var(--surface-hover)]/35"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--background)]"
                  style={{ backgroundColor: dot }}
                  aria-hidden
                />
                <span
                  className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                    active ? "text-[var(--foreground)]" : "text-[var(--foreground)]/90"
                  }`}
                >
                  {label}
                </span>
                <span className="shrink-0 text-lg font-bold tabular-nums tracking-tight text-[var(--foreground)]">
                  {pcts[i]!.toFixed(0)}%
                </span>
              </button>

              {expanded && (
                <OutcomeExpandPanel
                  tab={tab}
                  setTab={setTab}
                  tradingOpen={tradingOpen}
                  marketAddress={marketAddress}
                  collateralDecimals={collateralDecimals}
                  collateralTicker={collateralTicker}
                  outcomeLabels={labels}
                  outcomeIndex={i}
                  obSnapshot={selectedIndex === i ? obSnapshot : null}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

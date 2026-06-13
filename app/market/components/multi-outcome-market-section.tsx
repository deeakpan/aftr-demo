"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { MarketTradeVolumeChart } from "@/app/market/components/market-trade-volume-chart";
import { MultiOutcomePicker } from "@/app/market/components/multi-outcome-picker";

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

function OutcomeOrderBook({
  snapshot,
  collateralDecimals,
}: {
  snapshot: OutcomeOrderBookSnapshot | null;
  collateralDecimals: number;
}) {
  if (!snapshot || (snapshot.bidPrices.length === 0 && snapshot.askPrices.length === 0)) {
    return <p className="py-6 text-sm text-[var(--muted)]">No open orders for this outcome yet.</p>;
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
  const [tab, setTab] = useState<"activity" | "orderbook">("activity");
  const tradingOpen = marketState === 0;
  const selectedLabel = labels[selectedIndex] ?? `Outcome ${selectedIndex + 1}`;

  return (
    <div className="mb-6">
      <MultiOutcomePicker
        labels={labels}
        chancePcts={chancePcts}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
      />

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] font-medium uppercase tracking-wider">
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
          <span className="ml-auto text-[10px] normal-case tracking-normal text-[var(--muted)]">
            {selectedLabel}
          </span>
        </div>

        {tab === "activity" ? (
          <MarketTradeVolumeChart
            marketAddress={marketAddress}
            collateralDecimals={collateralDecimals}
            collateralTicker={collateralTicker}
            outcomeLabels={labels}
            highlightOutcomeIndex={selectedIndex}
            height={320}
          />
        ) : (
          <OutcomeOrderBook snapshot={obSnapshot} collateralDecimals={collateralDecimals} />
        )}
      </div>
    </div>
  );
}

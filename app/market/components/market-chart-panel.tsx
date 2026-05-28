"use client";

import { useState } from "react";
import { MarketTradeVolumeChart } from "@/app/market/components/market-trade-volume-chart";
import { TradingViewChart } from "@/app/market/components/trading-view-chart";

type Props = {
  marketKind: "Event" | "Price";
  marketAddress: string;
  collateralDecimals: number;
  collateralTicker: string;
  outcomeLabels: string[];
  tvSymbol: string | null;
  chartThemeKey: string;
};

export function MarketChartPanel({
  marketKind,
  marketAddress,
  collateralDecimals,
  collateralTicker,
  outcomeLabels,
  tvSymbol,
  chartThemeKey,
}: Props) {
  const isPrice = marketKind === "Price";
  const [view, setView] = useState<"activity" | "price">("activity");

  if (!isPrice) {
    return (
      <MarketTradeVolumeChart
        marketAddress={marketAddress}
        collateralDecimals={collateralDecimals}
        collateralTicker={collateralTicker}
        outcomeLabels={outcomeLabels}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-[11px] font-medium uppercase tracking-wider">
        <button
          type="button"
          onClick={() => setView("activity")}
          className={`transition ${
            view === "activity"
              ? "text-[var(--foreground)]"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          Market
        </button>
        <button
          type="button"
          onClick={() => setView("price")}
          disabled={!tvSymbol}
          className={`transition disabled:opacity-40 ${
            view === "price"
              ? "text-[var(--foreground)]"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          Asset price
        </button>
      </div>

      {view === "activity" ? (
        <MarketTradeVolumeChart
          marketAddress={marketAddress}
          collateralDecimals={collateralDecimals}
          collateralTicker={collateralTicker}
          outcomeLabels={outcomeLabels}
        />
      ) : tvSymbol ? (
        <TradingViewChart key={`${tvSymbol}-${chartThemeKey}`} symbol={tvSymbol} />
      ) : null}
    </div>
  );
}

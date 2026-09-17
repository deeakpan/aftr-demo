"use client";

import { useState } from "react";
import { MarketTradeList } from "@/app/market/components/market-trade-list";
import { MarketTradeVolumeChart } from "@/app/market/components/market-trade-volume-chart";
import { TradingViewChart } from "@/app/market/components/trading-view-chart";
import type { UiMarketKind } from "@/lib/markets/market-kind";

type Props = {
  marketKind: UiMarketKind;
  marketAddress: string;
  collateralDecimals: number;
  collateralTicker: string;
  outcomeLabels: string[];
  tvSymbol: string | null;
  chartThemeKey: string;
  /** Live on-chain chance % to pin the chart end-state. */
  liveChancePcts?: number[];
};

export function MarketChartPanel({
  marketKind,
  marketAddress,
  collateralDecimals,
  collateralTicker,
  outcomeLabels,
  tvSymbol,
  chartThemeKey,
  liveChancePcts,
}: Props) {
  const isPrice = marketKind === "Price";
  const [view, setView] = useState<"activity" | "price">("activity");

  const tradeList = (
    <MarketTradeList
      marketAddress={marketAddress}
      collateralDecimals={collateralDecimals}
      collateralTicker={collateralTicker}
      outcomeLabels={outcomeLabels}
      className="mt-6"
    />
  );

  const chart = (
    <MarketTradeVolumeChart
      marketAddress={marketAddress}
      collateralDecimals={collateralDecimals}
      collateralTicker={collateralTicker}
      outcomeLabels={outcomeLabels}
      liveChancePcts={liveChancePcts}
    />
  );

  if (!isPrice) {
    return (
      <div>
        {chart}
        {tradeList}
      </div>
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
        <>
          {chart}
          {tradeList}
        </>
      ) : tvSymbol ? (
        <TradingViewChart key={`${tvSymbol}-${chartThemeKey}`} symbol={tvSymbol} />
      ) : null}
    </div>
  );
}

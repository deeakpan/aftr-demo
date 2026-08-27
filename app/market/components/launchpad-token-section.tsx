"use client";

import { useCallback, useState } from "react";
import { DexScreenerTokenChart } from "@/app/market/components/dexscreener-token-chart";
import { MarketChartPanel } from "@/app/market/components/market-chart-panel";
import { NadTokenPanel } from "@/app/market/components/nad-token-panel";
import type { NadMarketConfig, NadTokenRef } from "@/lib/nad/types";
import type { UiMarketKind } from "@/lib/markets/market-kind";

type Props = {
  nadMarket: NadMarketConfig;
  marketKind: UiMarketKind;
  marketAddress: string;
  collateralDecimals: number;
  collateralTicker: string;
  outcomeLabels: string[];
  chartThemeKey: string;
  /** When true, skip market volume chart (e.g. multi-outcome already has activity panels). */
  hideMarketChartFallback?: boolean;
};

export function LaunchpadTokenSection({
  nadMarket,
  marketKind,
  marketAddress,
  collateralDecimals,
  collateralTicker,
  outcomeLabels,
  chartThemeKey,
  hideMarketChartFallback = false,
}: Props) {
  const [activeToken, setActiveToken] = useState<NadTokenRef | null>(
    nadMarket.tokens[0] ?? null,
  );
  const [dexAvailable, setDexAvailable] = useState(false);

  const onActiveTokenChange = useCallback((token: NadTokenRef) => {
    setActiveToken(token);
    setDexAvailable(false);
  }, []);

  const onDexAvailability = useCallback((available: boolean) => {
    setDexAvailable(available);
  }, []);

  return (
    <div className="space-y-4">
      <NadTokenPanel nadMarket={nadMarket} onActiveTokenChange={onActiveTokenChange} />
      {activeToken ? (
        <DexScreenerTokenChart
          tokenAddress={activeToken.address}
          onAvailabilityChange={onDexAvailability}
        />
      ) : null}
      {!dexAvailable && !hideMarketChartFallback ? (
        <MarketChartPanel
          marketKind={marketKind}
          marketAddress={marketAddress}
          collateralDecimals={collateralDecimals}
          collateralTicker={collateralTicker}
          outcomeLabels={outcomeLabels}
          tvSymbol={null}
          chartThemeKey={chartThemeKey}
        />
      ) : null}
    </div>
  );
}

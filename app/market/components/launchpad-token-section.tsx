"use client";

import { useCallback, useState } from "react";
import { DexScreenerTokenChart } from "@/app/market/components/dexscreener-token-chart";
import { MarketChartPanel } from "@/app/market/components/market-chart-panel";
import { NadTokenPanel } from "@/app/market/components/nad-token-panel";
import { isPrismDisplayMarket } from "@/lib/launchpad/fetch-token-display";
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
  /** Synced with selected outcome on comparison markets. */
  activeTokenIndex?: number;
  onActiveTokenIndexChange?: (index: number) => void;
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
  activeTokenIndex,
  onActiveTokenIndexChange,
}: Props) {
  const skipDexChart = isPrismDisplayMarket(nadMarket);
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

  const showTradesChart =
    !hideMarketChartFallback && (skipDexChart || !dexAvailable);

  return (
    <div className="space-y-4">
      <NadTokenPanel
        nadMarket={nadMarket}
        activeIndex={activeTokenIndex}
        onActiveIndexChange={onActiveTokenIndexChange}
        onActiveTokenChange={onActiveTokenChange}
      />
      {!skipDexChart && activeToken ? (
        <DexScreenerTokenChart
          key={`${activeToken.address.toLowerCase()}:${activeToken.sourceUrl ?? ""}`}
          tokenAddress={activeToken.address}
          pairUrl={activeToken.sourceUrl || nadMarket.apiBaseUrl || null}
          onAvailabilityChange={onDexAvailability}
        />
      ) : null}
      {showTradesChart ? (
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

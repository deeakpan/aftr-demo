"use client";

import { NadComparisonOutcomeRow } from "@/app/market/components/nad-comparison-outcome-row";
import { useNadComparisonStats } from "@/app/market/hooks/use-nad-comparison-stats";
import { outcomeColor } from "@/app/market/lib/outcome-colors";
import { nadTokenForOutcome } from "@/app/market/components/nad-market-list-card";
import type { OutcomeOrderBookSnapshot } from "@/app/market/components/outcome-order-book";
import { formatChancePct } from "@/lib/format-chance-pct";
import type { NadMarketConfig } from "@/lib/nad/types";

export type { OutcomeOrderBookSnapshot };

type MultiOutcomeMarketSectionProps = {
  labels: string[];
  chancePcts: number[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  marketAddress: string;
  collateralDecimals: number;
  collateralTicker: string;
  marketState: number;
  /** Kept for API compatibility; order book lives under the trade panel now. */
  obSnapshot?: OutcomeOrderBookSnapshot | null;
  nadMarket?: NadMarketConfig | null;
};

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

export function MultiOutcomeMarketSection({
  labels,
  chancePcts,
  selectedIndex,
  onSelect,
  marketState,
  nadMarket = null,
}: MultiOutcomeMarketSectionProps) {
  const tradingOpen = marketState === 0;

  const showMcapRows = nadMarket != null && nadMarket.mode === "comparison";
  const comparisonValueKind = nadMarket?.questionType === "price_highest" ? "price" : "mcap";

  const comparisonTokens = nadMarket?.tokens ?? [];

  const { stats: liveStats, loading: statsLoading } = useNadComparisonStats(
    comparisonTokens,
    showMcapRows,
    undefined,
    nadMarket,
  );

  const statsByAddress = new Map<string, number | null>();
  comparisonTokens.forEach((t, i) => {
    const row = liveStats[i];
    statsByAddress.set(
      t.address.toLowerCase(),
      comparisonValueKind === "price" ? (row?.priceUsd ?? null) : (row?.marketCapUsd ?? null),
    );
  });

  const pcts = labels.map((_, i) =>
    clampPct(chancePcts[i] ?? (i === 0 ? 50 : Math.round(50 / Math.max(1, labels.length - 1)))),
  );

  return (
    <div className="mb-6">
      <div className="flex flex-col">
        {labels.map((label, i) => {
          const tok = showMcapRows && nadMarket ? nadTokenForOutcome(nadMarket, label, i) : undefined;
          const usdValue =
            showMcapRows && tok
              ? (statsByAddress.get(tok.address.toLowerCase()) ?? null)
              : null;
          const selected = selectedIndex === i;

          return (
            <div key={`${label}-${i}`} className="border-b border-[var(--border)] py-0.5 last:border-b-0">
              {showMcapRows ? (
                <NadComparisonOutcomeRow
                  symbol={tok?.symbol ?? label}
                  imageUri={tok?.imageUri}
                  usdValue={usdValue}
                  valueKind={comparisonValueKind}
                  chancePct={pcts[i]!}
                  loading={statsLoading && label.toUpperCase() !== "NEITHER"}
                  interactive={tradingOpen}
                  tradingClosed={!tradingOpen}
                  active={selected}
                  onClick={tradingOpen ? () => onSelect(i) : undefined}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  className={`flex w-full items-center gap-3 px-3 py-3.5 text-left transition ${
                    selected
                      ? "rounded-xl border border-[var(--accent)] bg-[var(--surface-hover)]/40"
                      : "rounded-lg border border-transparent hover:bg-[var(--surface-hover)]/35"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--background)]"
                    style={{ backgroundColor: outcomeColor(i) }}
                    aria-hidden
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                      selected ? "text-[var(--foreground)]" : "text-[var(--foreground)]/90"
                    }`}
                  >
                    {label}
                  </span>
                  <span className="shrink-0 text-lg font-bold tabular-nums tracking-tight text-[var(--foreground)]">
                    {formatChancePct(pcts[i]!)}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

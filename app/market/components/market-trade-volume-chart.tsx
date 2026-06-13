"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { OUTCOME_COLORS } from "@/app/market/lib/outcome-colors";

export type MarketTradePoint = {
  id: string;
  timestamp: number;
  collateralAmount: string;
  outcomeIndex: number;
  kind: string;
};

type Props = {
  marketAddress: string;
  collateralDecimals: number;
  collateralTicker?: string;
  outcomeLabels: string[];
  height?: number;
  /** Emphasize one outcome line when viewing multi-outcome detail. */
  highlightOutcomeIndex?: number;
};

type SeriesPoint = { t: number; pct: number };

type OutcomeSeries = {
  index: number;
  label: string;
  color: string;
  points: SeriesPoint[];
  currentPct: number;
};

/** Polymarket-adjacent palette on dark backgrounds. */
const OUTCOME_COLORS_CHART = OUTCOME_COLORS;

const VB = { w: 1000, h: 300 };
const PAD = { top: 12, right: 56, bottom: 36, left: 12 };

function amountHuman(t: MarketTradePoint, decimals: number): number {
  return Number(formatUnits(BigInt(t.collateralAmount || "0"), decimals));
}

/** Replay pool collateral per outcome → implied share % after each event. */
function buildOutcomeSeries(
  trades: MarketTradePoint[],
  outcomeLabels: string[],
  collateralDecimals: number,
): OutcomeSeries[] {
  const n = Math.max(outcomeLabels.length, 1);
  const pools = Array.from({ length: n }, () => 0);
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const snapshots: { ts: number; pcts: number[] }[] = [];

  const snapshot = (ts: number) => {
    const total = pools.reduce((a, b) => a + b, 0);
    const pcts =
      total > 0
        ? pools.map((p) => (p / total) * 100)
        : Array.from({ length: n }, () => 100 / n);
    snapshots.push({ ts, pcts });
  };

  if (sorted.length === 0) {
    return Array.from({ length: n }, (_, i) => ({
      index: i,
      label: outcomeLabels[i] ?? `Outcome ${i + 1}`,
      color: OUTCOME_COLORS_CHART[i % OUTCOME_COLORS_CHART.length]!,
      points: [],
      currentPct: 100 / n,
    }));
  }

  snapshot(sorted[0]!.timestamp - 60);

  for (const trade of sorted) {
    const idx = trade.outcomeIndex;
    if (idx >= 0 && idx < n) {
      const amt = amountHuman(trade, collateralDecimals);
      if (trade.kind === "redeem") {
        pools[idx] = Math.max(0, pools[idx]! - amt);
      } else {
        pools[idx]! += amt;
      }
    }
    snapshot(trade.timestamp);
  }

  return Array.from({ length: n }, (_, i) => {
    const points = snapshots.map((s) => ({
      t: s.ts * 1000,
      pct: s.pcts[i] ?? 0,
    }));
    const last = points[points.length - 1]?.pct ?? 100 / n;
    return {
      index: i,
      label: outcomeLabels[i] ?? `Outcome ${i + 1}`,
      color: OUTCOME_COLORS_CHART[i % OUTCOME_COLORS_CHART.length]!,
      points,
      currentPct: last,
    };
  });
}

function formatAxisDate(ms: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function polylinePoints(
  points: SeriesPoint[],
  minT: number,
  maxT: number,
  innerW: number,
  innerH: number,
): string {
  if (points.length === 0) return "";
  const span = Math.max(maxT - minT, 60_000);
  return points
    .map((p) => {
      const x = PAD.left + ((p.t - minT) / span) * innerW;
      const y = PAD.top + innerH * (1 - Math.min(100, Math.max(0, p.pct)) / 100);
      return `${x},${y}`;
    })
    .join(" ");
}

export function MarketTradeVolumeChart({
  marketAddress,
  collateralDecimals,
  outcomeLabels,
  height = 340,
  highlightOutcomeIndex,
}: Props) {
  const [trades, setTrades] = useState<MarketTradePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  const loadTrades = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError("");
    void fetch(`/api/market/trades?market=${encodeURIComponent(marketAddress)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const j = (await res.json()) as {
          trades?: MarketTradePoint[];
          unavailable?: boolean;
          reason?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setTrades([]);
          setUnavailable(true);
          setFetchError(j.error || j.reason || `HTTP ${res.status}`);
          return;
        }
        setTrades(j.trades ?? []);
        setUnavailable(Boolean(j.unavailable));
        if (j.unavailable && j.reason) setFetchError(j.reason);
      })
      .catch((err) => {
        if (!cancelled) {
          setTrades([]);
          setUnavailable(true);
          setFetchError(err instanceof Error ? err.message : "Could not load trades");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketAddress]);

  useEffect(() => loadTrades(), [loadTrades, reloadKey]);

  const series = useMemo(
    () => buildOutcomeSeries(trades, outcomeLabels, collateralDecimals),
    [trades, outcomeLabels, collateralDecimals],
  );

  const chart = useMemo(() => {
    const allPoints = series.flatMap((s) => s.points);
    if (allPoints.length === 0) return null;

    const minT = Math.min(...allPoints.map((p) => p.t));
    const maxT = Math.max(...allPoints.map((p) => p.t));
    const innerW = VB.w - PAD.left - PAD.right;
    const innerH = VB.h - PAD.top - PAD.bottom;
    const span = Math.max(maxT - minT, 60_000);

    const yTicks = [0, 25, 50, 75, 100];
    const xTickCount = 5;
    const xTicks = Array.from({ length: xTickCount }, (_, i) => {
      const frac = i / (xTickCount - 1);
      return minT + span * frac;
    });

    return { minT, maxT, innerW, innerH, span, yTicks, xTicks };
  }, [series]);

  const hoverSnap = useMemo(() => {
    if (!chart || hoverMs == null) return null;
    const { minT, span } = chart;
    const target = Math.max(minT, Math.min(minT + span, hoverMs));
    return series.map((s) => {
      let best = s.points[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const p of s.points) {
        const d = Math.abs(p.t - target);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      return { label: s.label, color: s.color, pct: best?.pct ?? 0 };
    });
  }, [chart, hoverMs, series]);

  const innerH = VB.h - PAD.top - PAD.bottom;
  const innerW = VB.w - PAD.left - PAD.right;
  const emphasizeOne =
    highlightOutcomeIndex !== undefined &&
    highlightOutcomeIndex >= 0 &&
    highlightOutcomeIndex < series.length;

  return (
    <div className="relative z-0 w-full select-none" style={{ minHeight: height }}>
      {/* Legend — inline, no box */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {series.map((s) => {
          const dimmed = emphasizeOne && s.index !== highlightOutcomeIndex;
          return (
          <div
            key={s.index}
            className={`flex items-center gap-2 text-sm transition-opacity ${dimmed ? "opacity-40" : ""}`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-[var(--foreground)]/90">{s.label}</span>
            <span className="tabular-nums text-[var(--muted)]">
              {s.currentPct.toFixed(0)}%
            </span>
          </div>
          );
        })}
      </div>

      <div className="relative w-full" style={{ height: height - 40 }}>
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            Loading…
          </div>
        )}

        {!loading && trades.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-[var(--muted)]">
            <p>{unavailable ? "Could not load market history." : "No trade history yet."}</p>
            {fetchError ? <p className="max-w-md text-xs opacity-70">{fetchError}</p> : null}
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && chart && (
          <svg
            viewBox={`0 0 ${VB.w} ${VB.h}`}
            className="h-full w-full"
            preserveAspectRatio="none"
            onMouseLeave={() => setHoverMs(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = (e.clientX - rect.left) / rect.width;
              const ms = chart.minT + chart.span * frac;
              setHoverMs(ms);
            }}
          >
            {/* Horizontal grid */}
            {[0, 25, 50, 75, 100].map((pct) => {
              const y = PAD.top + innerH * (1 - pct / 100);
              return (
                <g key={pct}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + innerW}
                    y1={y}
                    y2={y}
                    stroke="var(--foreground)"
                    strokeOpacity={0.06}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left + innerW + 8}
                    y={y + 4}
                    className="fill-[var(--muted)] text-[11px] tabular-nums"
                    style={{ fontSize: 11 }}
                  >
                    {pct}%
                  </text>
                </g>
              );
            })}

            {/* X-axis dates */}
            {chart.xTicks.map((ms) => {
              const x = PAD.left + ((ms - chart.minT) / chart.span) * innerW;
              return (
                <text
                  key={ms}
                  x={x}
                  y={VB.h - 10}
                  textAnchor="middle"
                  className="fill-[var(--muted)]"
                  style={{ fontSize: 11 }}
                >
                  {formatAxisDate(ms)}
                </text>
              );
            })}

            {/* Outcome lines */}
            {series.map((s) => {
              const highlighted = !emphasizeOne || s.index === highlightOutcomeIndex;
              return (
              <polyline
                key={s.index}
                fill="none"
                stroke={s.color}
                strokeWidth={highlighted ? 2.25 : 1.25}
                strokeOpacity={highlighted ? 1 : 0.28}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                points={polylinePoints(s.points, chart.minT, chart.maxT, innerW, innerH)}
              />
              );
            })}

            {/* End markers + labels */}
            {series.map((s) => {
              const last = s.points[s.points.length - 1];
              if (!last) return null;
              const highlighted = !emphasizeOne || s.index === highlightOutcomeIndex;
              const x = PAD.left + ((last.t - chart.minT) / chart.span) * innerW;
              const y = PAD.top + innerH * (1 - last.pct / 100);
              return (
                <g key={`end-${s.index}`} opacity={highlighted ? 1 : 0.35}>
                  <circle cx={x} cy={y} r={highlighted ? 4 : 2.5} fill={s.color} />
                  {highlighted && (
                  <text
                    x={PAD.left + innerW + 8}
                    y={y + 4}
                    className="tabular-nums"
                    style={{ fontSize: 12, fill: s.color }}
                  >
                    {last.pct.toFixed(0)}%
                  </text>
                  )}
                </g>
              );
            })}

            {hoverMs != null && (
              <line
                x1={PAD.left + ((hoverMs - chart.minT) / chart.span) * innerW}
                x2={PAD.left + ((hoverMs - chart.minT) / chart.span) * innerW}
                y1={PAD.top}
                y2={PAD.top + innerH}
                stroke="var(--foreground)"
                strokeOpacity={0.12}
                strokeWidth={1}
              />
            )}
          </svg>
        )}

        {hoverSnap && (
          <div className="pointer-events-none absolute bottom-1 left-0 flex flex-wrap gap-3 text-[11px] text-[var(--muted)]">
            <span>{formatAxisDate(hoverMs!)}</span>
            {hoverSnap.map((h) => (
              <span key={h.label} style={{ color: h.color }}>
                {h.label} {h.pct.toFixed(1)}%
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

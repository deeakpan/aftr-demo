"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type Address } from "viem";
import { OUTCOME_COLORS } from "@/app/market/lib/outcome-colors";
import { formatChancePct } from "@/lib/format-chance-pct";
import {
  applyBuy,
  applySell,
  calcBuyAmount,
  calcSellAmount,
  marginalPricePcts,
} from "@/lib/fpmm-math";
import { MARKET_READ_ABI } from "@/lib/market-abi";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import { TRADE_FEE_TOTAL_BPS, tradeFeesFromAmount } from "@/lib/trade-fees";

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
  /** Optional live odds to pin the final chart point (from on-chain priceOf). */
  liveChancePcts?: number[];
};

type SeriesPoint = { t: number; pct: number };

type OutcomeSeries = {
  index: number;
  label: string;
  color: string;
  points: SeriesPoint[];
  currentPct: number;
};

const OUTCOME_COLORS_CHART = OUTCOME_COLORS;

const VB = { w: 1000, h: 300 };
const PAD = { top: 12, right: 56, bottom: 36, left: 12 };

/** Forward-simulate FPMM pools from equal seed through buy/sell trades. */
function simulatePools(
  seedPerOutcome: bigint,
  n: number,
  trades: MarketTradePoint[],
): { pools: bigint[]; snapshots: { ts: number; pcts: number[] }[] } {
  let pools = Array.from({ length: n }, () => seedPerOutcome);
  const snapshots: { ts: number; pcts: number[] }[] = [];
  const push = (ts: number) => {
    snapshots.push({ ts, pcts: marginalPricePcts(pools) });
  };

  if (trades.length === 0) {
    push(Math.floor(Date.now() / 1000));
    return { pools, snapshots };
  }

  push(trades[0]!.timestamp - 60);

  for (const trade of trades) {
    const idx = trade.outcomeIndex;
    if (idx < 0 || idx >= n) {
      push(trade.timestamp);
      continue;
    }
    let amount = 0n;
    try {
      amount = BigInt(trade.collateralAmount || "0");
    } catch {
      push(trade.timestamp);
      continue;
    }
    if (amount <= 0n) {
      push(trade.timestamp);
      continue;
    }

    try {
      if (trade.kind === "sell") {
        const tokensIn = calcSellAmount(amount, idx, pools, BigInt(TRADE_FEE_TOTAL_BPS));
        pools = applySell(pools, idx, amount, tokensIn);
      } else if (trade.kind === "buy" || trade.kind === "deposit") {
        const { netAmount } = tradeFeesFromAmount(amount);
        if (netAmount > 0n) {
          const tokensOut = calcBuyAmount(netAmount, idx, pools, 0n);
          pools = applyBuy(pools, idx, netAmount, tokensOut);
        }
      }
      // redeem: ignore for pool odds (settlement path)
    } catch {
      // skip malformed / impossible trade vs current pools
    }
    // Clamp empty pools so marginalPrice still works
    pools = pools.map((p) => (p > 0n ? p : 1n));
    push(trade.timestamp);
  }

  return { pools, snapshots };
}

function poolDistance(a: readonly bigint[], b: readonly bigint[]): bigint {
  let d = 0n;
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0n) - (b[i] ?? 0n);
    d += diff < 0n ? -diff : diff;
  }
  return d;
}

/**
 * Find equal initial seed that best matches live on-chain pools after replaying trades.
 * Falls back to a size derived from trade notionals when live pools are missing.
 */
function resolveSeedPerOutcome(
  n: number,
  trades: MarketTradePoint[],
  livePools: bigint[] | null,
  collateralDecimals: number,
): bigint {
  const maxTrade = trades.reduce((m, t) => {
    try {
      const v = BigInt(t.collateralAmount || "0");
      return v > m ? v : m;
    } catch {
      return m;
    }
  }, 0n);

  const fallback =
    maxTrade > 0n
      ? maxTrade
      : 10n ** BigInt(Math.max(0, collateralDecimals)); // 1 unit

  if (!livePools || livePools.length !== n || livePools.every((p) => p === 0n)) {
    return fallback;
  }

  let lo = 1n;
  let hi = livePools.reduce((a, b) => (a > b ? a : b), 0n) + maxTrade * 2n + fallback;
  if (hi <= lo) hi = fallback * 10n;

  let best = fallback;
  let bestDist = poolDistance(
    simulatePools(fallback, n, trades).pools,
    livePools,
  );

  // Binary search equal seed against live pools
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2n;
    if (mid <= 0n) break;
    const { pools } = simulatePools(mid, n, trades);
    const dist = poolDistance(pools, livePools);
    if (dist < bestDist) {
      bestDist = dist;
      best = mid;
    }
    // If simulated pools are generally larger than live, seed too high
    const simSum = pools.reduce((a, b) => a + b, 0n);
    const liveSum = livePools.reduce((a, b) => a + b, 0n);
    if (simSum > liveSum) hi = mid;
    else lo = mid + 1n;
    if (hi <= lo) break;
  }

  return best > 0n ? best : fallback;
}

function buildOutcomeSeries(
  trades: MarketTradePoint[],
  outcomeLabels: string[],
  collateralDecimals: number,
  livePools: bigint[] | null,
  liveChancePcts?: number[],
): OutcomeSeries[] {
  const n = Math.max(outcomeLabels.length, 1);
  const sorted = [...trades]
    .filter((t) => t.kind === "buy" || t.kind === "deposit" || t.kind === "sell")
    .sort((a, b) => a.timestamp - b.timestamp);

  const seed = resolveSeedPerOutcome(n, sorted, livePools, collateralDecimals);
  const { snapshots } = simulatePools(seed, n, sorted);

  // Pin final point to live on-chain odds when available
  if (liveChancePcts && liveChancePcts.length === n && snapshots.length > 0) {
    const last = snapshots[snapshots.length - 1]!;
    snapshots[snapshots.length - 1] = {
      ts: last.ts,
      pcts: liveChancePcts.map((p) =>
        Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0,
      ),
    };
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
  liveChancePcts,
}: Props) {
  const [trades, setTrades] = useState<MarketTradePoint[]>([]);
  const [livePools, setLivePools] = useState<bigint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  const loadTrades = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError("");
    void fetch(
      `/api/market/trades?market=${encodeURIComponent(marketAddress)}&first=1000&order=asc`,
      { cache: "no-store" },
    )
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

  useEffect(() => {
    let cancelled = false;
    const n = outcomeLabels.length;
    if (n < 2) {
      setLivePools(null);
      return;
    }
    void (async () => {
      try {
        const client = deploymentPublicClient;
        const pools = await Promise.all(
          Array.from({ length: n }, (_, i) =>
            client.readContract({
              address: marketAddress as Address,
              abi: MARKET_READ_ABI,
              functionName: "poolBalances",
              args: [BigInt(i)],
            }),
          ),
        );
        if (!cancelled) setLivePools(pools.map((p) => p as bigint));
      } catch {
        if (!cancelled) setLivePools(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketAddress, outcomeLabels.length, reloadKey]);

  const series = useMemo(
    () =>
      buildOutcomeSeries(
        trades,
        outcomeLabels,
        collateralDecimals,
        livePools,
        liveChancePcts,
      ),
    [trades, outcomeLabels, collateralDecimals, livePools, liveChancePcts],
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
  const chartAreaHeight = height - 48;

  return (
    <div className="relative z-0 w-full select-none" style={{ minHeight: height }}>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {series.map((s) => (
          <div key={s.index} className="flex items-center gap-2 text-sm">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-[var(--foreground)]/90">{s.label}</span>
            <span className="tabular-nums text-[var(--muted)]">
              {formatChancePct(s.currentPct)}
            </span>
          </div>
        ))}
      </div>

      <div className="relative w-full" style={{ height: chartAreaHeight }}>
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
              className="text-xs font-medium text-[var(--foreground)] underline underline-offset-2 hover:opacity-80"
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

            {series.map((s) => (
              <polyline
                key={s.index}
                fill="none"
                stroke={s.color}
                strokeWidth={2.25}
                strokeOpacity={1}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                points={polylinePoints(s.points, chart.minT, chart.maxT, innerW, innerH)}
              />
            ))}

            {series.map((s) => {
              const last = s.points[s.points.length - 1];
              if (!last) return null;
              const x = PAD.left + ((last.t - chart.minT) / chart.span) * innerW;
              const y = PAD.top + innerH * (1 - last.pct / 100);
              return (
                <g key={`end-${s.index}`}>
                  <circle cx={x} cy={y} r={3.5} fill={s.color} />
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
                {h.label} {formatChancePct(h.pct)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { formatUnits } from "viem";

export type OutcomeOrderBookSnapshot = {
  bidPrices: bigint[];
  bidVolumes: bigint[];
  askPrices: bigint[];
  askVolumes: bigint[];
};

type Props = {
  snapshot: OutcomeOrderBookSnapshot | null;
  collateralDecimals: number;
  /** Optional header label, e.g. outcome name */
  title?: string;
  className?: string;
  maxRows?: number;
};

export function OutcomeOrderBook({
  snapshot,
  collateralDecimals,
  title,
  className = "",
  maxRows = 8,
}: Props) {
  const empty =
    !snapshot || (snapshot.bidPrices.length === 0 && snapshot.askPrices.length === 0);

  return (
    <div className={className}>
      {title ? (
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">
          {title}
        </p>
      ) : null}
      {empty ? (
        <p className="py-2 text-sm text-[var(--muted)]">No open orders for this outcome yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-500">Bids</p>
            <div className="space-y-1">
              {[...snapshot!.bidPrices.map((p, i) => ({ p, v: snapshot!.bidVolumes[i]! }))]
                .sort((a, b) => Number(b.p - a.p))
                .slice(0, maxRows)
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
              {[...snapshot!.askPrices.map((p, i) => ({ p, v: snapshot!.askVolumes[i]! }))]
                .sort((a, b) => Number(a.p - b.p))
                .slice(0, maxRows)
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
      )}
    </div>
  );
}

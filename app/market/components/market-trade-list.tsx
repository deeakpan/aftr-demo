"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { formatUnits } from "viem";
import { txExplorerUrl } from "@/lib/chain";

export type MarketTradeListItem = {
  id: string;
  timestamp: number;
  collateralAmount: string;
  outcomeIndex: number;
  kind: string;
  trader: string | null;
};

type Props = {
  marketAddress: string;
  collateralDecimals: number;
  collateralTicker: string;
  outcomeLabels: string[];
  className?: string;
};

function shortenAddress(addr: string) {
  if (!addr || addr.length < 10) return addr || "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function relativeTime(unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatAmount(raw: string, decimals: number): string {
  try {
    const n = Number(formatUnits(BigInt(raw), decimals));
    if (!Number.isFinite(n)) return raw;
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  } catch {
    return raw;
  }
}

/** trade id is usually `${txHash}-${logIndex}` */
function txHashFromTradeId(id: string): `0x${string}` | null {
  const hex = id.split("-")[0]?.trim() ?? "";
  if (/^0x[a-fA-F0-9]{64}$/.test(hex)) return hex as `0x${string}`;
  return null;
}

export function MarketTradeList({
  marketAddress,
  collateralDecimals,
  collateralTicker,
  outcomeLabels,
  className = "",
}: Props) {
  const [trades, setTrades] = useState<MarketTradeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(
      `/api/market/trades?market=${encodeURIComponent(marketAddress)}&first=40`,
      { cache: "no-store" },
    )
      .then(async (res) => {
        const json = (await res.json()) as {
          trades?: MarketTradeListItem[];
          unavailable?: boolean;
        };
        if (cancelled) return;
        setTrades(json.trades ?? []);
        setUnavailable(Boolean(json.unavailable));
      })
      .catch(() => {
        if (!cancelled) {
          setTrades([]);
          setUnavailable(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketAddress]);

  return (
    <div className={className}>
      <div className="mb-4 flex items-end justify-between border-t border-[var(--border)] pt-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Recent trades
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">Latest buys and redemptions on this market</p>
        </div>
        {!loading && !unavailable && trades.length > 0 ? (
          <span className="text-[11px] tabular-nums text-[var(--muted)]">{trades.length} shown</span>
        ) : null}
      </div>

      {loading && (
        <div className="space-y-2.5">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-[3.75rem] animate-pulse rounded-xl bg-[var(--surface)]" />
          ))}
        </div>
      )}

      {!loading && unavailable && (
        <p className="text-sm text-[var(--muted)]">Trade history unavailable (subgraph offline).</p>
      )}

      {!loading && !unavailable && trades.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No trades indexed for this market yet.</p>
      )}

      {!loading && !unavailable && trades.length > 0 && (
        <ul className="styled-scroll max-h-[17.5rem] space-y-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-[18.5rem]">
          {trades.map((t) => {
            const isBuy = t.kind === "deposit";
            const outcome =
              outcomeLabels[t.outcomeIndex] ?? `Outcome ${t.outcomeIndex + 1}`;
            const amount = formatAmount(t.collateralAmount, collateralDecimals);
            const trader = t.trader ? shortenAddress(t.trader) : "Someone";
            const tx = txHashFromTradeId(t.id);
            const href = tx ? txExplorerUrl(tx) : null;

            const body = (
              <>
                <div
                  className={`absolute inset-y-2.5 left-0 w-1 rounded-full ${
                    isBuy ? "bg-[var(--outcome-yes)]" : "bg-[var(--outcome-no)]"
                  }`}
                  aria-hidden
                />

                <div className="flex items-start justify-between gap-3 pl-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          isBuy
                            ? "bg-[var(--outcome-yes)]/15 text-[var(--outcome-yes)]"
                            : "bg-[var(--outcome-no)]/15 text-[var(--outcome-no)]"
                        }`}
                      >
                        {isBuy ? "Buy" : "Redeem"}
                      </span>
                      <span className="truncate text-[13px] font-semibold text-[var(--foreground)]">
                        {outcome}
                      </span>
                    </div>

                    <p className="mt-1 text-[15px] font-semibold tabular-nums leading-none tracking-tight text-[var(--foreground)]">
                      {amount}{" "}
                      <span className="text-xs font-medium text-[var(--muted)]">{collateralTicker}</span>
                    </p>

                    <p className="mt-1.5 font-mono text-[10px] text-[var(--muted)]">{trader}</p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                    <span className="text-[10px] tabular-nums text-[var(--muted)]">
                      {relativeTime(t.timestamp)}
                    </span>
                    {href ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--muted)] opacity-70 transition group-hover:opacity-100">
                        Tx
                        <ArrowSquareOut size={11} weight="bold" />
                      </span>
                    ) : null}
                  </div>
                </div>
              </>
            );

            return (
              <li key={t.id}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative block rounded-xl bg-[var(--surface)] px-3 py-2.5 transition hover:bg-[var(--surface-hover)]"
                  >
                    {body}
                  </a>
                ) : (
                  <div className="relative rounded-xl bg-[var(--surface)] px-3 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

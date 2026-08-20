"use client";

import { ArrowSquareOut, CopySimple } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ponsTokenPageUrl } from "@/lib/pons/config";
import type { NadMarketConfig, NadTokenRef } from "@/lib/nad/types";
import {
  formatNadHolderCount,
  formatNadMcapUsd,
  formatNadPriceUsd,
  formatNadVolume,
  parseNadMarketStats,
} from "@/lib/nad/market-stats";

type Props = {
  nadMarket: NadMarketConfig;
};

function TokenTicker({ symbol, address }: { symbol: string; address: string }) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <span className="group/ticker inline-flex items-center gap-1">
      <span className="font-bold text-[var(--foreground)]">${symbol}</span>
      <button
        type="button"
        onClick={() => void copyAddress()}
        className="inline-flex opacity-0 transition group-hover/ticker:opacity-100 text-[var(--muted)] hover:text-[var(--foreground)]"
        aria-label={copied ? "Copied" : `Copy ${symbol} contract address`}
        title={copied ? "Copied" : address}
      >
        <CopySimple size={13} weight="bold" />
      </button>
    </span>
  );
}

function TokenStatsBody({
  token,
  marketRaw,
  loading,
}: {
  token: NadTokenRef;
  marketRaw: Record<string, unknown> | null;
  loading: boolean;
}) {
  const stats = parseNadMarketStats(marketRaw, { isGraduated: token.isGraduated });
  const phase = token.isGraduated || stats.isOnDex ? "DEX" : "Bonding curve";

  return (
    <>
      <div className="flex items-center gap-3">
        {token.imageUri ? (
          <img
            src={token.imageUri}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-[var(--border)]"
          />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-xs font-bold text-[var(--muted)] ring-2 ring-[var(--border)]">
            {token.symbol.slice(0, 2)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <TokenTicker symbol={token.symbol} address={token.address} />
          </p>
          {token.name ? <p className="truncate text-xs text-[var(--muted)]">{token.name}</p> : null}
        </div>
        <a
          href={ponsTokenPageUrl(token.address)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[var(--muted)] transition hover:text-[var(--foreground)]"
          aria-label={`Open $${token.symbol} on Pons`}
          title="Open on Pons"
        >
          <ArrowSquareOut size={18} weight="bold" />
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
          <p className="text-[var(--muted)]">Phase</p>
          <p className="font-semibold text-[var(--foreground)]">{loading ? "…" : phase}</p>
        </div>
        <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
          <p className="text-[var(--muted)]">Price (USD)</p>
          <p className="font-semibold tabular-nums text-[var(--foreground)]">
            {loading ? "…" : formatNadPriceUsd(stats.priceUsd)}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
          <p className="text-[var(--muted)]">Market cap</p>
          <p className="font-semibold tabular-nums text-[var(--foreground)]">
            {loading ? "…" : formatNadMcapUsd(stats.marketCapUsd)}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
          <p className="text-[var(--muted)]">Holders</p>
          <p className="font-semibold tabular-nums text-[var(--foreground)]">
            {loading ? "…" : formatNadHolderCount(stats.holderCount)}
          </p>
        </div>
        <div className="col-span-2 rounded-lg bg-[var(--surface)] px-2.5 py-2">
          <p className="text-[var(--muted)]">Volume</p>
          <p className="font-semibold tabular-nums text-[var(--foreground)]">
            {loading ? "…" : formatNadVolume(marketRaw?.volume as string | undefined)}
          </p>
        </div>
      </div>
    </>
  );
}

export function NadTokenPanel({ nadMarket }: Props) {
  const tokens = nadMarket.tokens;
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState<{ token: NadTokenRef; marketRaw: Record<string, unknown> | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tokens.length === 0) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const results = await Promise.all(
        tokens.map(async (token) => {
          try {
            const res = await fetch(`/api/nad/token/${token.address}`);
            if (!res.ok) return { token, marketRaw: null };
            const json = (await res.json()) as { market_info?: Record<string, unknown> };
            return { token, marketRaw: json.market_info ?? null };
          } catch {
            return { token, marketRaw: null };
          }
        }),
      );
      if (!cancelled) {
        setRows(results);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokens.map((t) => t.address.toLowerCase()).join(",")]);

  if (tokens.length === 0) return null;

  const isComparison = nadMarket.mode === "comparison" && tokens.length > 1;
  const active = Math.min(tab, tokens.length - 1);
  const activeRow = rows[active] ?? { token: tokens[active]!, marketRaw: null };

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      {isComparison ? (
        <>
          <div className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2">
            {tokens.map((t, i) => (
              <button
                key={`${t.address.toLowerCase()}-${i}`}
                type="button"
                onClick={() => setTab(i)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  i === active
                    ? "bg-[var(--surface-hover)] text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                }`}
              >
                ${t.symbol}
              </button>
            ))}
          </div>
          <div className="pt-4">
            <TokenStatsBody token={activeRow.token} marketRaw={activeRow.marketRaw} loading={loading} />
          </div>
        </>
      ) : (
        <TokenStatsBody token={tokens[0]!} marketRaw={rows[0]?.marketRaw ?? null} loading={loading} />
      )}
    </div>
  );
}

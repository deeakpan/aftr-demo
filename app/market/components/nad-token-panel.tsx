"use client";

import { ArrowSquareOut, CopySimple } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { nadTokenPageUrl } from "@/lib/nad/config";
import type { NadMarketConfig } from "@/lib/nad/types";
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
        className="inline-flex opacity-0 transition group-hover/ticker:opacity-100 text-[var(--muted)] hover:text-violet-300"
        aria-label={copied ? "Copied" : `Copy ${symbol} contract address`}
        title={copied ? "Copied" : address}
      >
        <CopySimple size={13} weight="bold" />
      </button>
    </span>
  );
}

export function NadTokenPanel({ nadMarket }: Props) {
  const primary = nadMarket.tokens[0];
  const [marketRaw, setMarketRaw] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!primary) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/nad/token/${primary.address}`);
        const json = (await res.json()) as {
          market_info?: Record<string, unknown>;
          token_info?: { is_graduated?: boolean };
        };
        if (!cancelled) setMarketRaw(json.market_info ?? null);
      } catch {
        if (!cancelled) setMarketRaw(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [primary?.address]);

  const stats = useMemo(
    () =>
      parseNadMarketStats(marketRaw, {
        isGraduated: primary?.isGraduated,
      }),
    [marketRaw, primary?.isGraduated],
  );

  if (!primary) return null;

  const phase = primary.isGraduated || stats.isOnDex ? "DEX" : "Bonding curve";

  return (
    <div className="relative rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <a
        href={nadTokenPageUrl(primary.address)}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-4 top-4 text-[var(--muted)] transition hover:text-violet-300"
        aria-label="Open on Nad.fun"
        title="Open on Nad.fun"
      >
        <ArrowSquareOut size={18} weight="bold" />
      </a>

      <div className="flex items-center gap-3 pr-8">
        {primary.imageUri ? (
          <img src={primary.imageUri} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-[var(--border)]" />
        ) : null}
        <div>
          <p className="text-sm">
            <TokenTicker symbol={primary.symbol} address={primary.address} />
          </p>
          <p className="text-xs text-[var(--muted)]">{primary.name}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
          <p className="text-[var(--muted)]">Phase</p>
          <p className="font-semibold text-[var(--foreground)]">{phase}</p>
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

      {nadMarket.mode === "comparison" && nadMarket.tokens.length > 1 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Compared tokens</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {nadMarket.tokens.map((t) => (
              <span
                key={t.address}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px]"
              >
                {t.imageUri ? (
                  <img src={t.imageUri} alt="" className="h-4 w-4 rounded-full object-cover" />
                ) : null}
                <TokenTicker symbol={t.symbol} address={t.address} />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

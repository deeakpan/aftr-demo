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
  type NadLiveStats,
} from "@/lib/nad/market-stats";
import {
  fetchLaunchpadTokenDisplay,
  isPonsDisplayMarket,
  isPrismDisplayMarket,
  isTokenLinkDisplayMarket,
  isTokenLinkUrl,
} from "@/lib/launchpad/fetch-token-display";

type Props = {
  nadMarket: NadMarketConfig;
  /** Controlled tab index (e.g. synced with selected outcome on comparison markets). */
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  /** Notify parent which token tab is active (for DexScreener / chart fallback). */
  onActiveTokenChange?: (token: NadTokenRef) => void;
};

function TokenTicker({ symbol, address }: { symbol: string; address: string }) {
  const [copied, setCopied] = useState(false);
  const canCopy = /^0x[a-fA-F0-9]{40}$/.test(address);

  async function copyAddress() {
    if (!canCopy) return;
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
      {canCopy ? (
        <button
          type="button"
          onClick={() => void copyAddress()}
          className="inline-flex opacity-0 transition group-hover/ticker:opacity-100 text-[var(--muted)] hover:text-[var(--foreground)]"
          aria-label={copied ? "Copied" : `Copy ${symbol} contract address`}
          title={copied ? "Copied" : address}
        >
          <CopySimple size={13} weight="bold" />
        </button>
      ) : null}
    </span>
  );
}

function TokenStatsBody({
  token,
  stats,
  volumeLabel,
  loading,
  externalLink,
  prism,
}: {
  token: NadTokenRef;
  stats: NadLiveStats | null;
  volumeLabel: string;
  loading: boolean;
  externalLink: string;
  /** Prism RWA — no holders/volume/phase (those stay blank dashes). */
  prism?: boolean;
}) {
  const phase = token.isGraduated || stats?.isOnDex ? "DEX" : "Bonding curve";
  const showVolume =
    !prism && volumeLabel !== "—" && volumeLabel.trim() !== "";
  const showHolders = !prism && (loading || stats?.holderCount != null);

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
          href={externalLink}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[var(--muted)] transition hover:text-[var(--foreground)]"
          aria-label={`Open $${token.symbol}`}
          title="Open token page"
        >
          <ArrowSquareOut size={18} weight="bold" />
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        {!prism ? (
          <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
            <p className="text-[var(--muted)]">Phase</p>
            <p className="font-semibold text-[var(--foreground)]">{loading ? "…" : phase}</p>
          </div>
        ) : null}
        <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
          <p className="text-[var(--muted)]">Price (USD)</p>
          <p className="font-semibold tabular-nums text-[var(--foreground)]">
            {loading ? "…" : formatNadPriceUsd(stats?.priceUsd ?? null)}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
          <p className="text-[var(--muted)]">Market cap</p>
          <p className="font-semibold tabular-nums text-[var(--foreground)]">
            {loading ? "…" : formatNadMcapUsd(stats?.marketCapUsd ?? null)}
          </p>
        </div>
        {showHolders ? (
          <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
            <p className="text-[var(--muted)]">Holders</p>
            <p className="font-semibold tabular-nums text-[var(--foreground)]">
              {loading ? "…" : formatNadHolderCount(stats?.holderCount ?? null)}
            </p>
          </div>
        ) : null}
        {showVolume ? (
          <div className="col-span-2 rounded-lg bg-[var(--surface)] px-2.5 py-2">
            <p className="text-[var(--muted)]">Volume</p>
            <p className="font-semibold tabular-nums text-[var(--foreground)]">{volumeLabel}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function NadTokenPanel({
  nadMarket,
  activeIndex,
  onActiveIndexChange,
  onActiveTokenChange,
}: Props) {
  const tokens = nadMarket.tokens;
  const preferPons = isPonsDisplayMarket(nadMarket);
  const [tab, setTab] = useState(0);
  const controlled = typeof activeIndex === "number";
  const [rows, setRows] = useState<
    { token: NadTokenRef; stats: NadLiveStats | null; volumeLabel: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tokens.length === 0) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const results = await Promise.all(
        tokens.map(async (token) => {
          const row = await fetchLaunchpadTokenDisplay(token, preferPons);
          const volumeRaw = row.marketRaw?.volume;
          const volumeLabel =
            typeof volumeRaw === "string" || typeof volumeRaw === "number"
              ? formatNadVolume(String(volumeRaw))
              : "—";
          return { token: row.token, stats: row.stats, volumeLabel };
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
  }, [
    preferPons,
    tokens.map((t) => `${t.address.toLowerCase()}:${t.sourceUrl ?? ""}`).join(","),
  ]);

  const isComparison = nadMarket.mode === "comparison" && tokens.length > 1;
  const maxIdx = Math.max(tokens.length - 1, 0);
  const active = Math.min(controlled ? activeIndex! : tab, maxIdx);
  const activeRow = rows[active] ?? {
    token: tokens[active]!,
    stats: null,
    volumeLabel: "—",
  };

  useEffect(() => {
    if (!tokens[active]) return;
    onActiveTokenChange?.(rows[active]?.token ?? tokens[active]!);
  }, [active, rows, tokens, onActiveTokenChange]);

  function selectTab(i: number) {
    if (!controlled) setTab(i);
    onActiveIndexChange?.(i);
  }

  if (tokens.length === 0) return null;

  const tokenLinkMarket = isTokenLinkDisplayMarket(nadMarket);
  const prismMarket = isPrismDisplayMarket(nadMarket);
  const externalLinkFor = (token: NadTokenRef) => {
    if (token.sourceUrl && (isTokenLinkUrl(token.sourceUrl) || token.source === "prism" || prismMarket)) {
      return token.sourceUrl;
    }
    if (tokenLinkMarket && isTokenLinkUrl(nadMarket.apiBaseUrl)) return nadMarket.apiBaseUrl!;
    if (preferPons) return ponsTokenPageUrl(token.address);
    return `https://testnet.nad.fun/tokens/${token.address}`;
  };

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      {isComparison ? (
        <>
          <div className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2">
            {tokens.map((t, i) => (
              <button
                key={`${t.address.toLowerCase()}-${i}`}
                type="button"
                onClick={() => selectTab(i)}
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
            <TokenStatsBody
              token={activeRow.token}
              stats={activeRow.stats}
              volumeLabel={activeRow.volumeLabel}
              loading={loading}
              externalLink={externalLinkFor(activeRow.token)}
              prism={prismMarket}
            />
          </div>
        </>
      ) : (
        <TokenStatsBody
          token={rows[0]?.token ?? tokens[0]!}
          stats={rows[0]?.stats ?? null}
          volumeLabel={rows[0]?.volumeLabel ?? "—"}
          loading={loading}
          externalLink={externalLinkFor(rows[0]?.token ?? tokens[0]!)}
          prism={prismMarket}
        />
      )}
    </div>
  );
}

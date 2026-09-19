"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChartBar, CircleNotch, Clock, Rocket } from "@phosphor-icons/react";
import { isAddress } from "viem";
import { AppLayout } from "@/app/components/app-layout";
import {
  BinaryProbabilityPipe,
  MarketListCardSkeleton,
  MARKET_CARD_GRID_CLASS,
  MARKET_CARD_HOVER_CLASS,
  MARKET_CARD_SHELL_CLASS,
  MARKET_CARD_TITLE_CLASS,
} from "@/app/market/components/market-list-card";
import { MarketShareButton } from "@/app/market/components/market-share-button";
import { formatMarketCardDate, formatMarketClosesTooltip, MARKET_COVER_ASPECT_CLASS } from "@/lib/market-cover";
import { cacheMarketCardForDetail } from "@/lib/markets/market-card-cache";
import { marketPath } from "@/lib/markets/market-url";
import { useSessionWallet } from "@/lib/session-wallet";
import type { UiMarketKind } from "@/lib/markets/market-kind";
import type { NadMarketConfig } from "@/lib/nad/types";

type LaunchMarket = {
  address: `0x${string}`;
  kind: UiMarketKind;
  title: string;
  description: string;
  imageUrl: string;
  slug?: string;
  outcomeLabels: string[];
  outcomeChancePcts: number[];
  poolTvl: string;
  tradeVolume?: string;
  resolveAfterUnix: number;
  stakeEndUnix: number;
  marketState: number;
  categories?: string[];
  nadMarket?: NadMarketConfig | null;
  stateLabel?: string;
};

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function statusForLaunch(m: LaunchMarket, nowUnix: number): { label: string; tone: string } {
  if (m.marketState === 2) return { label: "Settled", tone: "text-[var(--outcome-yes)]" };
  if (m.marketState === 3) return { label: "Cancelled", tone: "text-[var(--muted)]" };
  if (m.marketState === 1 || nowUnix >= m.resolveAfterUnix) {
    return { label: "Awaiting resolution", tone: "text-amber-400" };
  }
  if (nowUnix >= m.stakeEndUnix) return { label: "Trading closed", tone: "text-amber-400" };
  return { label: "Open", tone: "text-[var(--foreground)]" };
}

/** Browse-only card: never renders Yes/No trade buttons. */
function LaunchBrowseCard({
  market,
  nowUnix,
  onOpen,
}: {
  market: LaunchMarket;
  nowUnix: number;
  onOpen: () => void;
}) {
  const status = statusForLaunch(market, nowUnix);
  const labels =
    market.outcomeLabels?.filter((l) => l.trim()).length >= 2
      ? market.outcomeLabels.filter((l) => l.trim()).slice(0, 8)
      : ["Yes", "No"];
  const pcts = labels.map((_, i) => {
    const raw = market.outcomeChancePcts?.[i];
    return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw as number)) : Math.round(100 / labels.length);
  });
  const isBinary = labels.length === 2;
  const resolveLabel = formatMarketCardDate(market.resolveAfterUnix * 1000) ?? "—";
  const resolveTip = formatMarketClosesTooltip(market.resolveAfterUnix * 1000);
  const cover =
    market.imageUrl ||
    market.nadMarket?.tokens?.[0]?.imageUri?.trim() ||
    "";

  return (
    <article
      className={`${MARKET_CARD_SHELL_CLASS} ${MARKET_CARD_HOVER_CLASS} cursor-pointer`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      role="link"
      tabIndex={0}
    >
      <div className={`${MARKET_COVER_ASPECT_CLASS} w-full shrink-0 overflow-hidden bg-[var(--surface)]`}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-full w-full object-cover object-center" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--muted)]">
            No cover image
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className={`${MARKET_CARD_TITLE_CLASS} line-clamp-2`}>{market.title || "Untitled market"}</p>
          <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${status.tone}`}>
            {status.label}
          </span>
        </div>

        {isBinary ? (
          <div className="space-y-1.5">
            <BinaryProbabilityPipe yesPct={pcts[0] ?? 50} noPct={pcts[1] ?? 50} />
            <div className="flex justify-between gap-2 text-xs text-[var(--muted)]">
              <span>
                {labels[0]} · {Math.round(pcts[0] ?? 50)}%
              </span>
              <span>
                {labels[1]} · {Math.round(pcts[1] ?? 50)}%
              </span>
            </div>
          </div>
        ) : (
          <ul className="space-y-1 text-xs text-[var(--muted)]">
            {labels.map((label, i) => (
              <li key={`${label}-${i}`} className="flex justify-between gap-2">
                <span className="truncate text-[var(--foreground)]">{label}</span>
                <span className="tabular-nums">{Math.round(pcts[i] ?? 0)}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] text-[var(--muted)]"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-semibold text-[var(--foreground)]">
          {market.tradeVolume &&
          market.tradeVolume !== "—" &&
          market.tradeVolume !== "0" &&
          market.tradeVolume !== "0.00" ? (
            <span className="inline-flex items-center gap-1">
              <ChartBar size={14} weight="bold" className="text-[var(--muted)]" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Vol
              </span>
              ${market.tradeVolume}
            </span>
          ) : (
            <span />
          )}
        </span>
        <div className="flex items-center gap-2">
          <MarketShareButton address={market.address} slug={market.slug} title={market.title} iconSize={13} />
          <span className="inline-flex items-center gap-1" title={resolveTip}>
            <Clock size={12} />
            {resolveLabel}
          </span>
        </div>
      </div>
    </article>
  );
}

export function LaunchesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address: sessionAddress, isConnected } = useSessionWallet();
  const walletParam = searchParams.get("wallet")?.trim() ?? "";

  const wallet = useMemo(() => {
    if (walletParam && isAddress(walletParam)) return walletParam;
    if (sessionAddress && isAddress(sessionAddress)) return sessionAddress;
    return null;
  }, [walletParam, sessionAddress]);

  const [markets, setMarkets] = useState<LaunchMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNowUnix(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!wallet) {
      setMarkets([]);
      setLoading(false);
      setError(isConnected ? "" : "Connect a wallet to see your launches.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        let json: {
          markets?: LaunchMarket[];
          error?: string;
          unavailable?: boolean;
          reason?: string;
        } = {};
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const res = await fetch(`/api/wallet/launches?wallet=${encodeURIComponent(wallet)}`, {
            cache: "no-store",
          });
          json = (await res.json()) as typeof json;
          if (cancelled) return;
          if (!res.ok) {
            if (attempt < maxAttempts && res.status >= 500) {
              await new Promise((r) => setTimeout(r, 400 * attempt));
              continue;
            }
            throw new Error(json.error ?? "Could not load launches.");
          }
          if (json.unavailable && attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
            continue;
          }
          break;
        }
        if (json.unavailable) {
          setError(json.reason ?? "Indexer unavailable.");
          setMarkets([]);
          return;
        }
        // Keep open + ended + settled — never filter by stake end.
        setMarkets(json.markets ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load launches.");
          setMarkets([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, isConnected]);

  const openMarket = (m: LaunchMarket) => {
    cacheMarketCardForDetail(m.address, {
      title: m.title,
      description: m.description,
      imageUrl: m.imageUrl,
      slug: m.slug,
      outcomeLabels: m.outcomeLabels,
      categories: m.categories,
    });
    router.push(marketPath({ slug: m.slug, address: m.address }));
  };

  return (
    <AppLayout>
      <section className="mx-4 pt-2 md:mx-6">
        <div className="mb-5 flex items-center gap-2">
          <Rocket size={18} weight="fill" className="text-[#68e0a0]" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--foreground)]">Launches</h1>
            <p className="text-xs text-[var(--muted)]">
              {wallet
                ? `All markets created by ${shorten(wallet)} — open and ended`
                : "Your created markets"}
            </p>
          </div>
        </div>

        {loading && (
          <div className={MARKET_CARD_GRID_CLASS}>
            {Array.from({ length: 3 }, (_, i) => (
              <MarketListCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="max-w-lg text-center text-sm text-[var(--muted)]">{error}</p>
          </div>
        )}

        {!loading && !error && markets.length === 0 && (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
            <p className="text-sm text-[var(--muted)]">No launches yet.</p>
            <button
              type="button"
              onClick={() => router.push("/create")}
              className="rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--background)] hover:opacity-90"
            >
              Create a market
            </button>
          </div>
        )}

        {!loading && markets.length > 0 && (
          <div className={MARKET_CARD_GRID_CLASS}>
            {markets.map((m) => (
              <LaunchBrowseCard key={m.address} market={m} nowUnix={nowUnix} onOpen={() => openMarket(m)} />
            ))}
          </div>
        )}

        {loading && (
          <p className="mt-4 inline-flex items-center gap-2 text-xs text-[var(--muted)]">
            <CircleNotch size={12} className="animate-spin" /> Loading launches…
          </p>
        )}
      </section>
    </AppLayout>
  );
}

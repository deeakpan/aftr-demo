"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleNotch, Rocket } from "@phosphor-icons/react";
import { isAddress } from "viem";
import { AppLayout } from "@/app/components/app-layout";
import {
  MarketListCard,
  MarketListCardSkeleton,
  MARKET_CARD_GRID_CLASS,
} from "@/app/market/components/market-list-card";
import { NadMarketListCard } from "@/app/market/components/nad-market-list-card";
import { formatMarketCardDate, formatMarketClosesTooltip } from "@/lib/market-cover";
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
  resolveAfterUnix: number;
  stakeEndUnix: number;
  marketState: number;
  categories?: string[];
  nadMarket?: NadMarketConfig | null;
};

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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
  /** Bumps so stake-end / settled cards flip off trade CTAs without refresh. */
  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNowUnix(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const isTradingClosed = (m: LaunchMarket) =>
    m.marketState !== 0 || nowUnix >= m.stakeEndUnix;

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
        const res = await fetch(`/api/wallet/launches?wallet=${encodeURIComponent(wallet)}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as {
          markets?: LaunchMarket[];
          error?: string;
          unavailable?: boolean;
          reason?: string;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? "Could not load launches.");
        if (json.unavailable) {
          setError(json.reason ?? "Indexer unavailable.");
          setMarkets([]);
          return;
        }
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
              {wallet ? `Markets created by ${shorten(wallet)}` : "Your created markets"}
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
            {markets.map((m) => {
              const closed = isTradingClosed(m);
              return m.nadMarket ? (
                <NadMarketListCard
                  key={m.address}
                  title={m.title}
                  nadMarket={m.nadMarket}
                  outcomeLabels={m.outcomeLabels ?? []}
                  outcomeChancePcts={m.outcomeChancePcts}
                  poolTvl={m.poolTvl}
                  resolveAfter={formatMarketCardDate(m.resolveAfterUnix * 1000) ?? "—"}
                  resolveAfterTooltip={formatMarketClosesTooltip(m.resolveAfterUnix * 1000)}
                  marketAddress={m.address}
                  slug={m.slug}
                  showNewBadge={false}
                  onTitleClick={() => openMarket(m)}
                  tradingClosed={closed}
                />
              ) : (
                <MarketListCard
                  key={m.address}
                  title={m.title}
                  imageUrl={m.imageUrl}
                  outcomeLabels={m.outcomeLabels ?? []}
                  outcomeChancePcts={m.outcomeChancePcts}
                  poolTvl={m.poolTvl}
                  resolveAfter={formatMarketCardDate(m.resolveAfterUnix * 1000) ?? "—"}
                  resolveAfterTooltip={formatMarketClosesTooltip(m.resolveAfterUnix * 1000)}
                  marketAddress={m.address}
                  slug={m.slug}
                  showNewBadge={false}
                  onTitleClick={() => openMarket(m)}
                  tradingClosed={closed}
                />
              );
            })}
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

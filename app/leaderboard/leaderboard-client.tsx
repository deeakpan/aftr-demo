"use client";

import { useEffect, useState } from "react";
import { CrownSimple } from "@phosphor-icons/react";
import { AppLayout } from "@/app/components/app-layout";

type LeaderRow = {
  address: string;
  username?: string | null;
  marketCount: number;
  pnlUsd: string;
  depositedUsd: string;
  redeemedUsd: string;
};

function short(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function LeaderboardClient() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetch("/api/leaderboard", { cache: "no-store" })
      .then(async (res) => {
        const j = (await res.json()) as { rows?: LeaderRow[]; error?: string };
        if (!res.ok) throw new Error(j.error || "Could not load leaderboard.");
        if (!cancelled) setRows(j.rows ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load leaderboard.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppLayout showSearch={false} pageBackgroundClassName="aftr-page-bg-gradient">
      <section className="mx-4 pt-8 md:mx-6">
        <div className="mb-2 flex items-center gap-2">
          <CrownSimple size={22} weight="bold" className="text-[#ffbf47]" />
          <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)] md:text-2xl">Leaderboard</h1>
        </div>
        <p className="max-w-xl text-sm text-[var(--muted)]">Top wallets ranked by indexed realized PnL.</p>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--elevated-card-shadow)] backdrop-blur-sm">
          <div className="grid grid-cols-[56px_1fr_110px_120px] border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            <span>Rank</span>
            <span>Wallet</span>
            <span className="text-right">Markets</span>
            <span className="text-right">PnL</span>
          </div>

          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="grid grid-cols-[56px_1fr_110px_120px] items-center border-b border-[var(--border)] px-3 py-2.5 text-sm last:border-b-0"
              >
                <span className="h-4 w-8 animate-pulse rounded bg-[var(--surface-hover)]" />
                <span className="h-4 w-36 animate-pulse rounded bg-[var(--surface-hover)]" />
                <span className="ml-auto h-4 w-10 animate-pulse rounded bg-[var(--surface-hover)]" />
                <span className="ml-auto h-4 w-16 animate-pulse rounded bg-[var(--surface-hover)]" />
              </div>
            ))}

          {!loading && !error && rows.length === 0 && (
            <div className="px-3 py-4 text-sm text-[var(--muted)]">No leaderboard data yet.</div>
          )}

          {!loading &&
            rows.map((r, i) => (
              <div
                key={`${r.address}-${i}`}
                className="grid grid-cols-[56px_1fr_110px_120px] items-center border-b border-[var(--border)] px-3 py-2.5 text-sm text-[var(--foreground)] last:border-b-0"
              >
                <span className="font-semibold text-[var(--muted)]">#{i + 1}</span>
                <span className="font-mono text-xs sm:text-sm" title={r.address}>
                  {r.username?.trim() || short(r.address)}
                </span>
                <span className="text-right tabular-nums text-[var(--muted)]">{r.marketCount}</span>
                <span className={`text-right tabular-nums font-semibold ${r.pnlUsd.startsWith("-") ? "text-rose-500 [html[data-theme=dark]_&]:text-rose-400" : "text-emerald-600 [html[data-theme=dark]_&]:text-emerald-400"}`}>
                  ${r.pnlUsd}
                </span>
              </div>
            ))}
        </div>
      </section>
    </AppLayout>
  );
}


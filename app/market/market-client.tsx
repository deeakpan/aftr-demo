"use client";

import { TrendUp } from "@phosphor-icons/react";
import { hasWalletConnectProjectId } from "../providers";
import { AppLayout } from "@/app/components/app-layout";

export function MarketClient() {
  return (
    <AppLayout showFilterStrip searchPlaceholder="Search markets... (Ctrl/Cmd + K)">
      <section className="mx-4 pt-8 md:mx-6">
        <div className="mb-2 flex items-center gap-2">
          <TrendUp size={22} weight="bold" className="text-[var(--accent)]" />
          <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)] md:text-2xl">
            Markets
          </h1>
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)]">No markets yet.</p>
        {!hasWalletConnectProjectId && (
          <p className="mt-4 text-sm text-red-400">
            Add <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs">NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</code>{" "}
            in <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs">.env</code>, then restart the dev server.
          </p>
        )}
      </section>
    </AppLayout>
  );
}

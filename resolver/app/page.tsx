"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type DueMarket = {
  address: string;
  kind: number;
  resolveAfter: number;
  metadataURI: string;
  sources: string[];
};

type CycleAction = {
  address: string;
  kind: number;
  action: string;
  outcomeIndex?: number;
  outcomeLabel?: string;
  reasoning?: string;
  txHash?: string;
  error?: string;
  skipped?: boolean;
};

type Cycle = {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  subgraphUrl: string;
  subgraphOk: boolean;
  subgraphError?: string;
  factoryOk: boolean;
  factoryError?: string;
  due: DueMarket[];
  actions: CycleAction[];
  resolver: string | null;
};

type Status = {
  network: string;
  chainId: number;
  subgraphUrl: string;
  factory?: string | null;
  factories: { fpmm: string | null };
  ponsResolutionAdmin: string | null;
  tokenResolutionAdmin?: string | null;
  botWallet: string | null;
  walletMatchesAdmin: boolean;
  pollMs: number;
};

function kindLabel(kind: number) {
  if (kind === 0) return "PRICE";
  if (kind === 1) return "EVENT";
  if (kind === 2) return "TOKEN";
  return `kind ${kind}`;
}

function fmtTs(unix: number) {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString();
}

function shorten(addr: string | null | undefined) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function HomePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollMs = status?.pollMs ?? 30_000;

  const run = useCallback(async (mode: "dry" | "settle") => {
    setBusy(true);
    setError(null);
    try {
      const path = mode === "settle" ? "/api/tick?settle=1" : "/api/tick?dry=1";
      const res = await fetch(path, { method: mode === "settle" ? "POST" : "GET", cache: "no-store" });
      const json = (await res.json()) as { status?: Status; cycle?: Cycle; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.status) setStatus(json.status);
      if (json.cycle) setCycle(json.cycle);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run("dry");
  }, [run]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      void run("settle");
    }, pollMs);
    return () => clearInterval(id);
  }, [auto, pollMs, run]);

  const dueCount = cycle?.due.length ?? 0;
  const failed = useMemo(() => cycle?.actions.filter((a) => a.error).length ?? 0, [cycle]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Zedkr</p>
          <h1 className="text-2xl font-semibold">Resolver bot</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Polls the subgraph and factory for PRICE / PONS markets past resolve time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm disabled:opacity-50"
            disabled={busy}
            onClick={() => void run("dry")}
            type="button"
          >
            Scan only
          </button>
          <button
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void run("settle")}
            type="button"
          >
            Settle now
          </button>
          <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
            <input checked={auto} onChange={(e) => setAuto(e.target.checked)} type="checkbox" />
            Auto every {Math.round(pollMs / 1000)}s
          </label>
        </div>
      </header>

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Network" value={status ? `${status.network} (${status.chainId})` : "…"} />
        <Stat
          label="Bot wallet"
          value={shorten(status?.botWallet)}
          hint={status?.walletMatchesAdmin ? "matches tokenResolutionAdmin" : "does not match admin"}
        />
        <Stat label="Due markets" value={String(dueCount)} hint={cycle?.dryRun ? "last run was dry" : "last run settled"} />
        <Stat
          label="Sources"
          value={`sub ${cycle?.subgraphOk ? "ok" : "fail"} · fac ${cycle?.factoryOk ? "ok" : "fail"}`}
          hint={failed ? `${failed} failed actions` : "no failed actions"}
        />
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
        <h2 className="mb-2 font-medium">Config</h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Row label="Subgraph" value={status?.subgraphUrl ?? "—"} />
          <Row label="FPMM factory" value={status?.factory ?? status?.factories.fpmm ?? "—"} />
          <Row label="tokenResolutionAdmin" value={status?.tokenResolutionAdmin ?? status?.ponsResolutionAdmin ?? "—"} />
        </dl>
        {cycle?.subgraphError ? <p className="mt-2 text-amber-300">Subgraph: {cycle.subgraphError}</p> : null}
        {cycle?.factoryError ? <p className="mt-2 text-amber-300">Factory: {cycle.factoryError}</p> : null}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 text-sm font-medium">Markets past resolve time</h2>
        {!cycle?.due.length ? (
          <p className="text-sm text-[var(--muted)]">None due.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Market</th>
                  <th className="pb-2 pr-3 font-medium">Kind</th>
                  <th className="pb-2 pr-3 font-medium">Resolve after</th>
                  <th className="pb-2 pr-3 font-medium">Found via</th>
                  <th className="pb-2 font-medium">Last action</th>
                </tr>
              </thead>
              <tbody>
                {cycle.due.map((m) => {
                  const action = cycle.actions.find((a) => a.address.toLowerCase() === m.address.toLowerCase());
                  return (
                    <tr className="border-t border-[var(--border)]" key={m.address}>
                      <td className="py-2 pr-3 font-mono text-xs">{m.address}</td>
                      <td className="py-2 pr-3">{kindLabel(m.kind)}</td>
                      <td className="py-2 pr-3">{fmtTs(m.resolveAfter)}</td>
                      <td className="py-2 pr-3">{m.sources.join(" + ")}</td>
                      <td className="py-2">
                        {action?.error ? (
                          <span className="text-red-300">{action.error}</span>
                        ) : action?.txHash ? (
                          <span className="text-emerald-300">{action.action} {shorten(action.txHash)}</span>
                        ) : (
                          <span className="text-[var(--muted)]">
                            {action?.action ?? "—"}
                            {action?.reasoning ? ` · ${action.reasoning}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {cycle ? (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Last cycle {cycle.finishedAt}
            {busy ? " · running…" : ""}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-all text-sm font-medium">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="break-all font-mono text-xs">{value}</dd>
    </div>
  );
}

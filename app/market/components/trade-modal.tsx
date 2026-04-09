"use client";

import { CheckCircle, PencilSimple, WarningCircle, X } from "@phosphor-icons/react";
import { formatUnits } from "viem";

type TradeModalProps = {
  open: boolean;
  onClose: () => void;
  marketTitle: string;
  /** e.g. bin range for price markets; shown under title */
  priceRangeLine: string | null;
  stakeEnds: string;
  resolveAfter: string;
  outcomeLabels: string[];
  selectedOutcomeIndex: number;
  onSelectOutcome: (index: number) => void;
  collateralDecimals: number;
  collateralTicker?: string;
  amount: string;
  setAmount: (v: string) => void;
  walletBalanceWei: bigint | null;
  /** `priceOf(outcome)` — contract 1e18 fixed-point (shown for transparency). */
  priceOfRaw: bigint | null;
  tokensFormatted: string | null;
  /** Collateral per outcome token, e.g. "$0.7761" */
  pricePerTokenLabel: string | null;
  slippageBps: number;
  onCycleSlippage: () => void;
  isNativeCollateral: boolean;
  needsApproval: boolean;
  approvalIcon: "none" | "warn" | "ok";
  approvalLine: string;
  tradeDisabled: boolean;
  status: string;
  busy: boolean;
  onSubmit: () => void;
};

const QUICK_AMOUNTS = ["10", "25", "50", "100"] as const;

function formatPriceOf(raw: bigint): string {
  return formatUnits(raw, 18);
}

export function TradeModal({
  open,
  onClose,
  marketTitle,
  priceRangeLine,
  stakeEnds,
  resolveAfter,
  outcomeLabels,
  selectedOutcomeIndex,
  onSelectOutcome,
  collateralDecimals,
  collateralTicker = "USDC",
  amount,
  setAmount,
  walletBalanceWei,
  priceOfRaw,
  tokensFormatted,
  pricePerTokenLabel,
  slippageBps,
  onCycleSlippage,
  isNativeCollateral,
  needsApproval,
  approvalIcon,
  approvalLine,
  tradeDisabled,
  status,
  busy,
  onSubmit,
}: TradeModalProps) {
  if (!open) return null;

  const labels = outcomeLabels.length > 0 ? outcomeLabels : ["Outcome 0"];
  const balanceStr =
    walletBalanceWei != null
      ? formatUnits(walletBalanceWei, collateralDecimals)
      : null;

  const selectedLabel = labels[selectedOutcomeIndex] ?? labels[0] ?? "Outcome";
  const actionLabel = `Buy ${selectedLabel}`;
  const hasTradeAmount = Boolean(tokensFormatted);
  const ctaLabel = busy
    ? "Processing…"
    : needsApproval && hasTradeAmount
      ? `Approve & ${actionLabel}`
      : actionLabel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-[2px] md:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="relative w-full max-w-[420px] overflow-hidden rounded-3xl border border-white/10 bg-black shadow-[0_24px_80px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/10 bg-black px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2
                  id="trade-modal-title"
                  className="text-base font-semibold tracking-tight text-white"
                >
                  {marketTitle}
                </h2>
                <span
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
                    selectedOutcomeIndex === 0
                      ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-300"
                      : selectedOutcomeIndex === 1
                        ? "border-rose-500/35 bg-rose-500/12 text-rose-300"
                        : "border-zinc-600 bg-zinc-800 text-zinc-200"
                  }`}
                >
                  {selectedLabel.toUpperCase()}
                </span>
              </div>
              {priceRangeLine && (
                <p className="mt-1 text-xl font-semibold tabular-nums text-white">{priceRangeLine}</p>
              )}
              <p className="mt-1.5 text-[11px] leading-snug text-zinc-500">
                <span>Staking ends</span>{" "}
                <span className="text-zinc-300">{stakeEnds}</span>
                <span className="mx-1.5 text-zinc-700">·</span>
                <span>Expires</span>{" "}
                <span className="text-zinc-300">{resolveAfter}</span>
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                <span className="font-medium text-emerald-400">Market</span>
                <span className="text-zinc-700"> · </span>
                <span className="text-zinc-600">Limit unavailable</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full p-1 text-zinc-500 transition hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X size={20} weight="bold" />
            </button>
          </div>
        </div>

        <div className="space-y-3 bg-black px-4 py-3">
          <div className="grid grid-cols-2 gap-1.5">
            {labels.slice(0, 4).map((label, idx) => {
              const active = idx === selectedOutcomeIndex;
              const isYesNo = idx === 0 || idx === 1;
              const isNo = idx === 1;
              const baseYes =
                "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-200/90 hover:border-emerald-500 hover:bg-emerald-600 hover:text-white";
              const activeYes =
                "border-emerald-500 bg-emerald-600 text-white shadow-[0_0_14px_rgba(16,185,129,0.22)]";
              const baseNo =
                "border-rose-500/30 bg-rose-500/[0.07] text-rose-200/90 hover:border-rose-500 hover:bg-rose-600 hover:text-white";
              const activeNo =
                "border-rose-500 bg-rose-600 text-white shadow-[0_0_14px_rgba(244,63,94,0.22)]";
              const neutralBase =
                "border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200";
              const neutralActive =
                "border-zinc-500 bg-zinc-800 text-white shadow-[0_0_16px_rgba(255,255,255,0.06)]";
              let cls = "rounded-xl border py-2.5 text-center text-xs font-semibold uppercase tracking-wide transition ";
              if (isYesNo) {
                if (isNo) cls += active ? activeNo : baseNo;
                else cls += active ? activeYes : baseYes;
              } else {
                cls += active ? neutralActive : neutralBase;
              }
              return (
                <button key={`${label}-${idx}`} type="button" onClick={() => onSelectOutcome(idx)} className={cls}>
                  {label}
                </button>
              );
            })}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Amount ({collateralTicker})
              </label>
              <span className="text-xs text-zinc-500">
                Balance{" "}
                <span className="font-mono font-medium tabular-nums text-zinc-200">
                  {collateralTicker === "USDC" ? "$" : ""}
                  {balanceStr ?? "—"}
                  {collateralTicker !== "USDC" && balanceStr != null ? ` ${collateralTicker}` : ""}
                </span>
              </span>
            </div>
            <div className="flex overflow-hidden rounded-xl border border-white/10 bg-zinc-950 ring-1 ring-transparent transition focus-within:border-emerald-500/40 focus-within:ring-emerald-500/10">
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base font-semibold tabular-nums text-white outline-none placeholder:text-zinc-600"
                placeholder="0"
              />
              <div className="flex items-center border-l border-white/10 bg-black/40 px-3 text-xs font-semibold text-zinc-500">
                {collateralTicker}
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmount(q)}
                  className="rounded-full border border-white/10 bg-zinc-950 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition hover:border-emerald-500/35 hover:text-emerald-300"
                >
                  {collateralTicker === "USDC" ? `$${q}` : `${q} ${collateralTicker}`}
                </button>
              ))}
            </div>
          </div>

          {approvalLine ? (
            <div
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                approvalIcon === "warn"
                  ? "border-amber-500/35 bg-amber-500/10 text-amber-200/90"
                  : "border-white/10 bg-zinc-950 text-zinc-400"
              }`}
            >
              {approvalIcon === "warn" && (
                <WarningCircle className="mt-0.5 shrink-0 text-amber-400/90" size={16} weight="bold" />
              )}
              {approvalIcon === "ok" && (
                <CheckCircle className="mt-0.5 shrink-0 text-emerald-400/90" size={16} weight="bold" />
              )}
              <p
                className={`min-w-0 flex-1 leading-snug ${
                  approvalIcon === "warn" ? "text-amber-100/90" : "text-zinc-400"
                }`}
              >
                {approvalLine}
              </p>
            </div>
          ) : null}

          <button
            type="button"
            onClick={onCycleSlippage}
            className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-2 text-left text-xs transition hover:bg-zinc-900"
          >
            <span className="text-zinc-500">Slippage</span>
            <span className="flex items-center gap-1 font-mono text-zinc-200 tabular-nums">
              {(slippageBps / 100).toFixed(1)}%
              <PencilSimple size={14} className="text-zinc-500" weight="bold" />
            </span>
          </button>

          <div className="rounded-xl border border-white/10 bg-zinc-950 p-3">
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Est. tokens</dt>
                <dd className="font-mono font-semibold tabular-nums text-white">
                  {tokensFormatted ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Price / token</dt>
                <dd className="font-mono font-semibold tabular-nums text-emerald-400">
                  {pricePerTokenLabel ?? "—"}
                </dd>
              </div>
            </dl>
            <details className="mt-2 border-t border-white/10 pt-2">
              <summary className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-300">
                Contract <code className="text-zinc-500">priceOf</code> (1e18)
              </summary>
              <p className="mt-1.5 font-mono text-[10px] tabular-nums text-zinc-500 break-all">
                {priceOfRaw != null && priceOfRaw > 0n ? formatPriceOf(priceOfRaw) : "—"}
              </p>
            </details>
          </div>

          {status && (
            <p className="text-center text-[11px] text-zinc-500">{status}</p>
          )}

          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || tradeDisabled}
            className="w-full rounded-xl bg-[var(--accent)] py-3 text-center text-sm font-bold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {tradeDisabled ? "Trading closed" : ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

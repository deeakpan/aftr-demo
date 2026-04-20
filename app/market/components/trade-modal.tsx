"use client";

import { useState } from "react";
import { CheckCircle, PencilSimple, WarningCircle, X } from "@phosphor-icons/react";
import { formatUnits } from "viem";

export type LimitOrderParams = {
  side: "buy" | "sell";
  outcomeIndex: number;
  price: string;
  amount: string;
};

type TradeModalProps = {
  open: boolean;
  onClose: () => void;
  /** When true renders inline (no overlay), ignores open/onClose */
  inline?: boolean;
  marketTitle: string;
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
  priceOfRaw: bigint | null;
  tokensFormatted: string | null;
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
  /** Optional — enables the Limit tab */
  onSubmitLimit?: (params: LimitOrderParams) => Promise<void>;
};

const QUICK_AMOUNTS = ["10", "25", "50", "100"] as const;

export function TradeModal({
  open,
  onClose,
  inline = false,
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
  onSubmitLimit,
}: TradeModalProps) {
  const [orderMode, setOrderMode] = useState<"market" | "limit">("market");
  const [limitSide, setLimitSide] = useState<"buy" | "sell">("buy");
  const [limitPrice, setLimitPrice] = useState("");
  const [limitAmount, setLimitAmount] = useState("");
  const [limitStatus, setLimitStatus] = useState("");
  const [limitBusy, setLimitBusy] = useState(false);

  if (!inline && !open) return null;

  const labels = outcomeLabels.length > 0 ? outcomeLabels : ["Outcome 0"];
  const balanceNum = walletBalanceWei != null ? Number(formatUnits(walletBalanceWei, collateralDecimals)) : null;
  const balanceFormatted = balanceNum != null
    ? balanceNum.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;
  const selectedLabel = labels[selectedOutcomeIndex] ?? labels[0] ?? "Outcome";
  const hasTradeAmount = Boolean(tokensFormatted);
  const marketCtaLabel = busy
    ? "Processing…"
    : needsApproval && hasTradeAmount
      ? `Approve & Buy ${selectedLabel}`
      : `Buy ${selectedLabel}`;

  const limitTotal = limitPrice && limitAmount && Number(limitPrice) > 0 && Number(limitAmount) > 0
    ? (Number(limitPrice) * Number(limitAmount)).toFixed(2)
    : null;

  const handleLimitSubmit = async () => {
    if (!onSubmitLimit || limitBusy) return;
    setLimitBusy(true);
    setLimitStatus("");
    try {
      await onSubmitLimit({ side: limitSide, outcomeIndex: selectedOutcomeIndex, price: limitPrice, amount: limitAmount });
      setLimitStatus("Order placed.");
      setLimitPrice("");
      setLimitAmount("");
    } catch (e) {
      setLimitStatus(e instanceof Error ? e.message.split("\n")[0]?.split("Contract Call:")[0]?.trim() ?? "Failed." : "Failed.");
    } finally {
      setLimitBusy(false);
    }
  };

  // ── Outcome selector buttons ─────────────────────────────────────────────
  const outcomeButtons = (
    <div className="grid grid-cols-2 gap-1.5">
      {labels.slice(0, 4).map((label, idx) => {
        const active = idx === selectedOutcomeIndex;
        const isNo = idx === 1;
        const isYesNo = idx <= 1;
        const baseYes = "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300/80 hover:border-emerald-500/60 hover:bg-emerald-600 hover:text-white";
        const activeYes = "border-emerald-500 bg-emerald-600 text-white";
        const baseNo = "border-rose-500/25 bg-rose-500/[0.06] text-rose-300/80 hover:border-rose-500/60 hover:bg-rose-600 hover:text-white";
        const activeNo = "border-rose-500 bg-rose-600 text-white";
        const neutralBase = "border-white/[0.06] bg-zinc-900/50 text-zinc-500 hover:text-zinc-200";
        const neutralActive = "border-zinc-500 bg-zinc-800 text-white";
        let cls = "rounded-lg border py-2 text-center text-[11px] font-semibold uppercase tracking-wider transition ";
        if (isYesNo) cls += isNo ? (active ? activeNo : baseNo) : (active ? activeYes : baseYes);
        else cls += active ? neutralActive : neutralBase;
        return (
          <button key={`${label}-${idx}`} type="button" onClick={() => onSelectOutcome(idx)} className={cls}>
            {label}
          </button>
        );
      })}
    </div>
  );

  // ── Panel content (shared between modal + inline) ────────────────────────
  const panelContent = (
    <div className={inline ? "space-y-3.5 px-4 py-4" : "space-y-3.5 bg-black px-4 py-4"}>

      {/* Mode tabs — text style, underline active */}
      <div className="flex border-b border-white/[0.06]">
        {(["market", "limit"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setOrderMode(m)}
            className={`-mb-px border-b-2 pb-2.5 pr-5 text-[11px] font-semibold capitalize tracking-wide transition
              ${orderMode === m
                ? "border-[var(--accent)] text-white"
                : "border-transparent text-zinc-600 hover:text-zinc-300"}`}>
            {m}
          </button>
        ))}
      </div>

      {/* Buy / Sell sub-tabs — only in limit mode */}
      {orderMode === "limit" && (
        <div className="flex border-b border-white/[0.04]">
          {(["buy", "sell"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setLimitSide(s)}
              className={`-mb-px border-b-2 pb-2 pr-4 text-[10px] font-semibold capitalize tracking-wide transition
                ${limitSide === s
                  ? s === "buy"
                    ? "border-emerald-500 text-emerald-400"
                    : "border-rose-500 text-rose-400"
                  : "border-transparent text-zinc-600 hover:text-zinc-400"}`}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Outcome selector */}
      {outcomeButtons}

      {orderMode === "market" ? (
        <>
          {/* Amount input */}
          <div>
            <div className="flex overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-800/40 transition focus-within:border-[var(--accent)]/35">
              <input
                type="text" inputMode="decimal" autoComplete="off"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm font-semibold tabular-nums text-white outline-none placeholder:text-zinc-700"
              />
              <div className="flex items-center border-l border-white/[0.07] bg-zinc-800/30 px-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                {collateralTicker}
              </div>
            </div>
            {/* Balance below input */}
            {balanceFormatted != null && (
              <p className="mt-1 text-[10px] text-zinc-700">
                Balance{" "}
                <span className="font-mono text-zinc-500">
                  {collateralTicker === "USDC" ? "$" : ""}{balanceFormatted}
                  {collateralTicker !== "USDC" ? ` ${collateralTicker}` : ""}
                </span>
              </p>
            )}
            {/* Quick amounts */}
            <div className="mt-2 flex gap-1">
              {QUICK_AMOUNTS.map((q) => (
                <button key={q} type="button" onClick={() => setAmount(q)}
                  className="flex-1 rounded-md border border-white/[0.07] bg-zinc-900/40 py-1.5 text-[10px] font-semibold text-zinc-600 transition hover:border-[var(--accent)]/30 hover:text-[var(--accent)]">
                  {collateralTicker === "USDC" ? `$${q}` : q}
                </button>
              ))}
            </div>
          </div>

          {/* Approval notice */}
          {approvalLine ? (
            <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${approvalIcon === "warn" ? "border-amber-500/30 bg-amber-500/8" : "border-white/[0.06] bg-zinc-900/40"}`}>
              {approvalIcon === "warn" && <WarningCircle className="mt-0.5 shrink-0 text-amber-400/80" size={13} weight="bold" />}
              {approvalIcon === "ok" && <CheckCircle className="mt-0.5 shrink-0 text-emerald-400/80" size={13} weight="bold" />}
              <p className={`min-w-0 flex-1 text-[10px] leading-snug ${approvalIcon === "warn" ? "text-amber-200/80" : "text-zinc-600"}`}>
                {approvalLine}
              </p>
            </div>
          ) : null}

          {/* Trade summary — inline rows, no box */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-600">Est. tokens</span>
              <span className="font-mono text-zinc-400">{tokensFormatted ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-600">Price / token</span>
              <span className="font-mono text-emerald-500">{pricePerTokenLabel ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <button type="button" onClick={onCycleSlippage} className="text-zinc-600 hover:text-zinc-400 transition">
                Slippage
              </button>
              <button type="button" onClick={onCycleSlippage}
                className="flex items-center gap-0.5 font-mono text-zinc-500 tabular-nums transition hover:text-zinc-300">
                {(slippageBps / 100).toFixed(1)}%
                <PencilSimple size={11} className="text-zinc-700" weight="bold" />
              </button>
            </div>
          </div>

          {status && <p className="text-center text-[10px] text-zinc-600">{status}</p>}

          <button type="button" onClick={onSubmit} disabled={busy || tradeDisabled}
            className="w-full rounded-lg bg-[var(--accent)] py-2.5 text-center text-xs font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
            {tradeDisabled ? "Trading closed" : marketCtaLabel}
          </button>
        </>
      ) : (
        <>
          {/* Limit inputs */}
          <div className="space-y-2.5">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Price per token
              </label>
              <div className="flex overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-800/40 transition focus-within:border-[var(--accent)]/35">
                <input type="text" inputMode="decimal" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="0.50"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm font-semibold text-white outline-none placeholder:text-zinc-700" />
                <div className="flex items-center border-l border-white/[0.07] bg-zinc-800/30 px-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                  USDC
                </div>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Amount
              </label>
              <div className="flex overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-800/40 transition focus-within:border-[var(--accent)]/35">
                <input type="text" inputMode="decimal" value={limitAmount} onChange={(e) => setLimitAmount(e.target.value)}
                  placeholder="100"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm font-semibold text-white outline-none placeholder:text-zinc-700" />
                <div className="flex items-center border-l border-white/[0.07] bg-zinc-800/30 px-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                  TOKENS
                </div>
              </div>
            </div>
            {limitTotal && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-600">Total</span>
                <span className="font-mono text-zinc-400">
                  ${limitTotal}{" "}
                  <span className="text-zinc-700">+ 0.5% fee</span>
                </span>
              </div>
            )}
          </div>

          {limitStatus && <p className="text-center text-[10px] text-zinc-600">{limitStatus}</p>}

          <button type="button" disabled={limitBusy || !onSubmitLimit} onClick={() => void handleLimitSubmit()}
            className={`w-full rounded-lg py-2.5 text-xs font-bold text-white transition disabled:opacity-40
              ${limitSide === "buy"
                ? "bg-emerald-600 shadow-[0_0_16px_rgba(16,185,129,0.22)] hover:bg-emerald-500"
                : "bg-rose-600 shadow-[0_0_16px_rgba(244,63,94,0.22)] hover:bg-rose-500"}`}>
            {limitBusy ? "Submitting…" : `${limitSide === "buy" ? "Buy" : "Sell"} ${selectedLabel}`}
          </button>
        </>
      )}
    </div>
  );

  // ── Inline mode ──────────────────────────────────────────────────────────
  if (inline) {
    return <>{panelContent}</>;
  }

  // ── Modal mode ───────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-[2px] md:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="relative w-full max-w-[400px] overflow-hidden rounded-3xl border border-white/10 bg-black shadow-[0_24px_80px_rgba(0,0,0,0.75)]"
        role="dialog" aria-modal="true" aria-labelledby="trade-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-white/[0.06] px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 id="trade-modal-title" className="text-sm font-semibold tracking-tight text-white">
                  {marketTitle}
                </h2>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide
                  ${selectedOutcomeIndex === 0
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : selectedOutcomeIndex === 1
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                      : "border-zinc-600 bg-zinc-800 text-zinc-300"}`}>
                  {selectedLabel.toUpperCase()}
                </span>
              </div>
              {priceRangeLine && (
                <p className="mt-1 text-base font-semibold tabular-nums text-white">{priceRangeLine}</p>
              )}
              <p className="mt-1 text-[10px] leading-snug text-zinc-600">
                Staking ends <span className="text-zinc-400">{stakeEnds}</span>
                <span className="mx-1.5 text-zinc-800">·</span>
                Expires <span className="text-zinc-400">{resolveAfter}</span>
              </p>
            </div>
            <button type="button" onClick={onClose}
              className="shrink-0 rounded-full p-1 text-zinc-600 transition hover:bg-white/10 hover:text-white"
              aria-label="Close">
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>
        {panelContent}
      </div>
    </div>
  );
}

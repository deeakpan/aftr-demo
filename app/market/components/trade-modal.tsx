"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, CheckCircle, PencilSimple, WarningCircle, X } from "@phosphor-icons/react";
import { formatUnits } from "viem";
import { isUsdStyledCollateralTicker } from "@/lib/deployment-collateral";

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
  outcomeTokenBalanceWei?: bigint | null;
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
const ORDERBOOK_FEE_BPS = 50; // 0.5% per side, matches AFTROrderBook default.

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
  outcomeTokenBalanceWei = null,
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
  const [limitAmountUnit, setLimitAmountUnit] = useState<"tokens" | "quote">("tokens");
  const [limitStatus, setLimitStatus] = useState("");
  const [limitBusy, setLimitBusy] = useState(false);

  const labels = outcomeLabels.length > 0 ? outcomeLabels : ["Outcome 0"];
  const balanceNum = walletBalanceWei != null ? Number(formatUnits(walletBalanceWei, collateralDecimals)) : null;
  const balanceFormatted = balanceNum != null
    ? balanceNum.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;
  const tokenBalanceNum = outcomeTokenBalanceWei != null
    ? Number(formatUnits(outcomeTokenBalanceWei, collateralDecimals))
    : null;
  const tokenBalanceFormatted = tokenBalanceNum != null
    ? tokenBalanceNum.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : null;
  const selectedLabel = labels[selectedOutcomeIndex] ?? labels[0] ?? "Outcome";
  const hasTradeAmount = Boolean(tokensFormatted);
  const marketCtaLabel = busy
    ? "Processing…"
    : needsApproval && hasTradeAmount
      ? `Approve & Buy ${selectedLabel}`
      : `Buy ${selectedLabel}`;

  const limitDerived = useMemo(() => {
    const p = Number(limitPrice);
    const a = Number(limitAmount);
    if (!Number.isFinite(p) || !Number.isFinite(a) || p <= 0 || a <= 0) {
      return { notionalUsdc: null as string | null, tokens: null as string | null };
    }
    if (limitAmountUnit === "tokens") {
      return {
        notionalUsdc: (p * a).toFixed(2),
        tokens: a.toFixed(4),
      };
    }
    return {
      notionalUsdc: a.toFixed(2),
      tokens: (a / p).toFixed(4),
    };
  }, [limitAmount, limitAmountUnit, limitPrice]);
  const minReceive = useMemo(() => {
    if (!limitDerived.notionalUsdc || !limitDerived.tokens) return null;
    const notional = Number(limitDerived.notionalUsdc);
    const tokens = Number(limitDerived.tokens);
    if (!Number.isFinite(notional) || !Number.isFinite(tokens) || notional <= 0 || tokens <= 0) return null;
    if (limitSide === "sell") {
      const netUsdc = notional * (1 - ORDERBOOK_FEE_BPS / 10000);
      return {
        label: "Min receive",
        value: isUsdStyledCollateralTicker(collateralTicker)
          ? `$${netUsdc.toFixed(2)} ${collateralTicker}`
          : `${netUsdc.toFixed(2)} ${collateralTicker}`,
      };
    }
    return {
      label: "Min receive",
      value: `${tokens.toFixed(4)} tokens`,
    };
  }, [limitDerived.notionalUsdc, limitDerived.tokens, limitSide, collateralTicker]);
  const sellValidationMessage = useMemo(() => {
    if (limitSide !== "sell") return "";
    const p = Number(limitPrice);
    const a = Number(limitAmount);
    const tokenBal = tokenBalanceNum;
    if (!Number.isFinite(p) || !Number.isFinite(a) || p <= 0 || a <= 0 || tokenBal === null) return "";
    const sellTokens = limitAmountUnit === "tokens" ? a : a / p;
    if (!Number.isFinite(sellTokens) || sellTokens <= 0) return "";
    if (sellTokens > tokenBal) {
      if (limitAmountUnit === "tokens") {
        return `Insufficient ${selectedLabel} balance. Max: ${tokenBal.toFixed(4)} tokens.`;
      }
      const maxUsdc = tokenBal * p;
      return isUsdStyledCollateralTicker(collateralTicker)
        ? `Insufficient ${selectedLabel} balance. Max sell value at this price: $${maxUsdc.toFixed(2)} ${collateralTicker}.`
        : `Insufficient ${selectedLabel} balance. Max sell value at this price: ${maxUsdc.toFixed(2)} ${collateralTicker}.`;
    }
    return "";
  }, [
    limitSide,
    limitPrice,
    limitAmount,
    limitAmountUnit,
    tokenBalanceNum,
    selectedLabel,
    collateralTicker,
  ]);
  const marketPrice = useMemo(() => {
    if (!priceOfRaw || priceOfRaw <= BigInt(0)) return null;
    const n = Number(formatUnits(priceOfRaw, 18));
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }, [priceOfRaw]);

  useEffect(() => {
    if (!marketPrice) return;
    const base = limitSide === "sell" ? marketPrice * 0.99 : marketPrice;
    setLimitPrice(base.toFixed(4));
    // Prefill when side/outcome/price context changes; field stays editable.
  }, [limitSide, selectedOutcomeIndex, marketPrice]);

  if (!inline && !open) return null;

  const handleLimitSubmit = async () => {
    if (!onSubmitLimit || limitBusy) return;
    setLimitBusy(true);
    setLimitStatus("");
    try {
      const priceNum = Number(limitPrice);
      const amountNum = Number(limitAmount);
      const tokensAmount =
        limitAmountUnit === "tokens" ? amountNum : amountNum / priceNum;
      if (limitSide === "sell" && tokenBalanceNum !== null && tokensAmount > tokenBalanceNum) {
        throw new Error(
          limitAmountUnit === "tokens"
            ? `Amount exceeds token balance (${tokenBalanceNum.toFixed(4)}).`
            : `Amount exceeds sellable value at this price.`,
        );
      }
      await onSubmitLimit({
        side: limitSide,
        outcomeIndex: selectedOutcomeIndex,
        price: limitPrice,
        amount: tokensAmount.toString(),
      });
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
        const baseYes =
          "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300/80 hover:border-emerald-500/60 hover:bg-emerald-600 hover:text-white [html[data-theme=light]_&]:bg-emerald-50 [html[data-theme=light]_&]:text-emerald-800 [html[data-theme=light]_&]:hover:bg-emerald-600 [html[data-theme=light]_&]:hover:text-white";
        const activeYes = "border-emerald-500 bg-emerald-600 text-white";
        const baseNo =
          "border-rose-500/25 bg-rose-500/[0.06] text-rose-300/80 hover:border-rose-500/60 hover:bg-rose-600 hover:text-white [html[data-theme=light]_&]:bg-rose-50 [html[data-theme=light]_&]:text-rose-800 [html[data-theme=light]_&]:hover:bg-rose-600 [html[data-theme=light]_&]:hover:text-white";
        const activeNo = "border-rose-500 bg-rose-600 text-white";
        const neutralBase =
          "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]";
        const neutralActive =
          "border-[var(--accent)]/50 bg-[var(--surface-hover)] text-[var(--foreground)]";
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
    <div
      className={
        inline ? "space-y-3.5 px-4 py-4" : "space-y-3.5 bg-[var(--card)] px-4 py-4"
      }
    >

      {/* Mode tabs — text style, underline active */}
      <div className="flex border-b border-[var(--border)]">
        {(["market", "limit"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setOrderMode(m)}
            className={`-mb-px border-b-2 pb-2.5 pr-5 text-[11px] font-semibold capitalize tracking-wide transition
              ${orderMode === m
                ? "border-[var(--accent)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}>
            {m}
          </button>
        ))}
      </div>

      {/* Buy / Sell sub-tabs — only in limit mode */}
      {orderMode === "limit" && (
        <div className="flex border-b border-[var(--border)]/70">
          {(["buy", "sell"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setLimitSide(s)}
              className={`-mb-px border-b-2 pb-2 pr-4 text-[10px] font-semibold capitalize tracking-wide transition
                ${limitSide === s
                  ? s === "buy"
                    ? "border-emerald-500 text-emerald-600 [html[data-theme=dark]_&]:text-emerald-400"
                    : "border-rose-500 text-rose-600 [html[data-theme=dark]_&]:text-rose-400"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}>
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
            <div className="flex overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] transition focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20">
              <input
                type="text" inputMode="decimal" autoComplete="off"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-semibold tabular-nums text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
              />
              <div className="flex items-center border-l border-[var(--border)] bg-transparent px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                {collateralTicker}
              </div>
            </div>
            {/* Balance below input */}
            {balanceFormatted != null && (
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Balance{" "}
                <span className="font-mono text-[var(--foreground)]/80">
                  {isUsdStyledCollateralTicker(collateralTicker) ? "$" : ""}{balanceFormatted}
                  {!isUsdStyledCollateralTicker(collateralTicker) ? ` ${collateralTicker}` : ""}
                </span>
              </p>
            )}
            {/* Quick amounts */}
            <div className="mt-2 flex gap-1">
              {QUICK_AMOUNTS.map((q) => (
                <button key={q} type="button" onClick={() => setAmount(q)}
                  className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] py-1.5 text-[10px] font-semibold text-[var(--muted)] transition hover:border-[var(--accent)]/30 hover:text-[var(--accent)]">
                  {isUsdStyledCollateralTicker(collateralTicker) ? `$${q}` : q}
                </button>
              ))}
            </div>
          </div>

          {/* Approval notice */}
          {approvalLine ? (
            <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${approvalIcon === "warn" ? "border-amber-500/30 bg-amber-500/10 [html[data-theme=dark]_&]:bg-amber-500/8" : "border-[var(--border)] bg-[var(--surface)]"}`}>
              {approvalIcon === "warn" && <WarningCircle className="mt-0.5 shrink-0 text-amber-400/80" size={13} weight="bold" />}
              {approvalIcon === "ok" && <CheckCircle className="mt-0.5 shrink-0 text-emerald-400/80" size={13} weight="bold" />}
              <p className={`min-w-0 flex-1 text-[10px] leading-snug ${approvalIcon === "warn" ? "text-amber-900 [html[data-theme=dark]_&]:text-amber-200/80" : "text-[var(--muted)]"}`}>
                {approvalLine}
              </p>
            </div>
          ) : null}

          {/* Trade summary — inline rows, no box */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--muted)]">Est. tokens</span>
              <span className="font-mono text-[var(--foreground)]">{tokensFormatted ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--muted)]">Price / token</span>
              <span className="font-mono text-emerald-600 [html[data-theme=dark]_&]:text-emerald-500">{pricePerTokenLabel ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <button type="button" onClick={onCycleSlippage} className="text-[var(--muted)] hover:text-[var(--foreground)] transition">
                Slippage
              </button>
              <button type="button" onClick={onCycleSlippage}
                className="flex items-center gap-0.5 font-mono text-[var(--muted)] tabular-nums transition hover:text-[var(--foreground)]">
                {(slippageBps / 100).toFixed(1)}%
                <PencilSimple size={11} className="text-[var(--muted)]" weight="bold" />
              </button>
            </div>
          </div>

          {status && <p className="text-center text-[10px] text-[var(--muted)]">{status}</p>}

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
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Price per token
              </label>
              <div className="flex overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] transition focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20">
                <input type="text" inputMode="decimal" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="0.50"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-semibold text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]" />
                <div className="flex items-center border-l border-[var(--border)] bg-transparent px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {collateralTicker}
                </div>
              </div>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Market: <span className="font-mono text-[var(--foreground)]/85">{marketPrice != null ? (isUsdStyledCollateralTicker(collateralTicker) ? `$${marketPrice.toFixed(4)} ${collateralTicker}` : `${marketPrice.toFixed(4)} ${collateralTicker}`) : "—"}</span>
              </p>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Amount
                </label>
                <button
                  type="button"
                  onClick={() => setLimitAmountUnit((u) => (u === "tokens" ? "quote" : "tokens"))}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] transition hover:text-[var(--foreground)]"
                  title="Switch amount unit"
                >
                  <ArrowsClockwise size={11} weight="bold" />
                  {limitAmountUnit === "tokens" ? "TOKENS" : collateralTicker}
                </button>
              </div>
              <div className="flex overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] transition focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20">
                <input type="text" inputMode="decimal" value={limitAmount} onChange={(e) => setLimitAmount(e.target.value)}
                  placeholder={limitAmountUnit === "tokens" ? "100" : "50"}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-semibold text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]" />
                <div className="flex items-center border-l border-[var(--border)] bg-transparent px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {limitAmountUnit === "tokens" ? "TOKENS" : collateralTicker}
                </div>
              </div>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Balance:{" "}
                <span className="font-mono text-[var(--foreground)]/85">
                  {limitAmountUnit === "tokens"
                    ? (tokenBalanceFormatted ?? "—")
                    : isUsdStyledCollateralTicker(collateralTicker)
                      ? `$${balanceFormatted ?? "—"}`
                      : `${balanceFormatted ?? "—"} ${collateralTicker}`}
                </span>
              </p>
              {limitSide === "sell" && sellValidationMessage && (
                <p className="mt-1 text-[10px] text-rose-400">{sellValidationMessage}</p>
              )}
            </div>
            {limitDerived.notionalUsdc && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--muted)]">Total</span>
                <span className="font-mono text-[var(--foreground)]">
                  {isUsdStyledCollateralTicker(collateralTicker) ? `$${limitDerived.notionalUsdc}` : `${limitDerived.notionalUsdc} ${collateralTicker}`}{" "}
                  <span className="text-[var(--muted)]">+ 0.5% fee</span>
                </span>
              </div>
            )}
            {limitDerived.tokens && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--muted)]">Est. tokens</span>
                <span className="font-mono text-[var(--foreground)]">{limitDerived.tokens}</span>
              </div>
            )}
            {minReceive && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--muted)]">{minReceive.label}</span>
                <span className="font-mono text-[var(--foreground)]">{minReceive.value}</span>
              </div>
            )}
          </div>

          {limitStatus && <p className="text-center text-[10px] text-[var(--muted)]">{limitStatus}</p>}

          <button type="button" disabled={limitBusy || !onSubmitLimit || Boolean(sellValidationMessage)} onClick={() => void handleLimitSubmit()}
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay-scrim)] p-3 backdrop-blur-[2px] md:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="relative w-full max-w-[400px] overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--elevated-card-shadow)]"
        role="dialog" aria-modal="true" aria-labelledby="trade-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[var(--border)] px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 id="trade-modal-title" className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
                  {marketTitle}
                </h2>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide
                  ${selectedOutcomeIndex === 0
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 [html[data-theme=light]_&]:text-emerald-800 [html[data-theme=light]_&]:bg-emerald-50"
                    : selectedOutcomeIndex === 1
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300 [html[data-theme=light]_&]:text-rose-800 [html[data-theme=light]_&]:bg-rose-50"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}>
                  {selectedLabel.toUpperCase()}
                </span>
              </div>
              {priceRangeLine && (
                <p className="mt-1 text-base font-semibold tabular-nums text-[var(--foreground)]">{priceRangeLine}</p>
              )}
              <p className="mt-1 text-[10px] leading-snug text-[var(--muted)]">
                Staking ends <span className="text-[var(--foreground)]/90">{stakeEnds}</span>
                <span className="mx-1.5 text-[var(--border)]">·</span>
                Expires <span className="text-[var(--foreground)]/90">{resolveAfter}</span>
              </p>
            </div>
            <button type="button" onClick={onClose}
              className="shrink-0 rounded-full p-1 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
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

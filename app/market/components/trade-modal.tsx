"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowsClockwise, CaretDown, CheckCircle, Gear, X } from "@phosphor-icons/react";
import { formatUnits } from "viem";
import { txExplorerUrl } from "@/lib/chain";
import { isUsdStyledCollateralTicker } from "@/lib/deployment-collateral";
import { BinaryProbabilityPipe, binaryOutcomePillClass } from "@/app/market/components/market-list-card";
import {
  SLIPPAGE_PRESETS_BPS,
  slippageBpsToInput,
  slippageInputToBps,
} from "@/lib/trade-slippage";

export type LimitOrderParams = {
  side: "buy" | "sell";
  outcomeIndex: number;
  price: string;
  amount: string;
};

export type TradeSuccessResult = {
  outcomeLabel: string;
  amountLabel: string;
  sharesLabel: string;
  txHash?: string;
  /** Defaults to buy copy when omitted. */
  side?: "buy" | "sell";
};

type TradeModalProps = {
  open: boolean;
  onClose: () => void;
  /** When true renders inline (no overlay), ignores open/onClose */
  inline?: boolean;
  /** Bottom sheet on mobile (full width, partial height, scrollable). */
  presentation?: "modal" | "sheet";
  marketTitle: string;
  priceRangeLine: string | null;
  stakeEnds: string;
  resolveAfter: string;
  /** Full close timestamp on hover (e.g. "Closes: Jan 1, 2027, 05:59 GMT+1"). */
  resolveAfterTooltip?: string;
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
  /** Est. outcome shares (buy: out / sell: in). */
  tokensFormatted: string | null;
  /** Collateral amount for the trade (buy: spend / sell: receive). */
  collateralFormatted?: string | null;
  pricePerTokenLabel: string | null;
  slippageBps: number;
  onSlippageBpsChange: (bps: number) => void;
  isNativeCollateral: boolean;
  tradeDisabled: boolean;
  status: string;
  busy: boolean;
  onSubmit: (side: "buy" | "sell") => void;
  /** FPMM markets: show Market Buy/Sell toggle and enable sell submits. */
  marketSellEnabled?: boolean;
  marketSide?: "buy" | "sell";
  onMarketSideChange?: (side: "buy" | "sell") => void;
  /** Fill amount with max sellable collateral return for the selected outcome. */
  onFillMaxSell?: () => void | Promise<void>;
  /** Optional — enables the Limit tab */
  onSubmitLimit?: (params: LimitOrderParams) => Promise<void>;
  tradeSuccess?: TradeSuccessResult | null;
  onDismissSuccess?: () => void;
  /** Implied % per outcome (same order as labels). */
  outcomeChancePcts?: number[];
  /** When true, outcome is picked on the page (multi-outcome markets). */
  hideOutcomeSelector?: boolean;
  isWalletConnected?: boolean;
  /** Extra content under the trade form (e.g. order book). */
  belowPanel?: ReactNode;
};

const QUICK_INCREMENTS = [1, 5, 10, 100] as const;
const ORDERBOOK_FEE_BPS = 50; // 0.5% per side, matches MondaloreOrderBook default.
const AMOUNT_INPUT_MAX_CHARS = 11;

function sanitizeDecimalInput(raw: string) {
  let cleaned = raw.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    cleaned = `${parts[0]}.${parts.slice(1).join("")}`;
  }
  return cleaned.slice(0, AMOUNT_INPUT_MAX_CHARS + 4);
}

function amountInputWidthChars(value: string, placeholder = "0") {
  return Math.min(AMOUNT_INPUT_MAX_CHARS, Math.max(1, (value || placeholder).length));
}

function RightAlignedAmountInput({
  value,
  onChange,
  placeholder = "0",
  textSizeClass = "text-3xl",
  valueColorClass = "text-[var(--muted)]",
  showDollar = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textSizeClass?: string;
  valueColorClass?: string;
  showDollar?: boolean;
}) {
  const widthCh = amountInputWidthChars(value, placeholder);
  return (
    <div className="flex min-w-0 max-w-[46%] shrink-0 justify-end overflow-hidden sm:max-w-[10.5rem]">
      <div className="inline-flex min-w-0 max-w-full items-baseline justify-end overflow-x-auto no-scrollbar">
        {showDollar && (
          <span className={`shrink-0 ${textSizeClass} font-semibold tabular-nums text-[var(--muted)]`}>$</span>
        )}
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(sanitizeDecimalInput(e.target.value))}
          placeholder={placeholder}
          style={{ width: `${widthCh}ch` }}
          className={`max-w-full shrink-0 bg-transparent text-right ${textSizeClass} font-semibold tabular-nums outline-none placeholder:text-[var(--muted)]/70 ${valueColorClass}`}
        />
      </div>
    </div>
  );
}

function TradeSummaryBox({
  rows,
}: {
  rows: { label: string; value: ReactNode; valueClass?: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="glass-panel-inset space-y-3 rounded-2xl px-4 py-3.5">
      {rows.map(({ label, value, valueClass }) => (
        <div key={label} className="flex items-center justify-between gap-3 text-[13px]">
          <span className="shrink-0 text-[var(--muted)]">{label}</span>
          <span
            className={`min-w-0 text-right font-mono tabular-nums ${valueClass ?? "font-semibold text-[var(--foreground)]"}`}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TradeModal({
  open,
  onClose,
  inline = false,
  presentation = "modal",
  marketTitle,
  priceRangeLine,
  stakeEnds,
  resolveAfter,
  resolveAfterTooltip,
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
  collateralFormatted = null,
  pricePerTokenLabel,
  slippageBps,
  onSlippageBpsChange,
  isNativeCollateral,
  tradeDisabled,
  status,
  busy,
  onSubmit,
  marketSellEnabled = false,
  marketSide: marketSideProp,
  onMarketSideChange,
  onFillMaxSell,
  onSubmitLimit,
  tradeSuccess = null,
  onDismissSuccess,
  outcomeChancePcts,
  hideOutcomeSelector = false,
  isWalletConnected = true,
  belowPanel,
}: TradeModalProps) {
  const [orderMode, setOrderMode] = useState<"market" | "limit">("market");
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [slippageDraft, setSlippageDraft] = useState(() => slippageBpsToInput(slippageBps));
  const [marketSideInternal, setMarketSideInternal] = useState<"buy" | "sell">("buy");
  const marketSide = marketSideProp ?? marketSideInternal;
  const setMarketSide = (side: "buy" | "sell") => {
    onMarketSideChange?.(side);
    if (marketSideProp === undefined) setMarketSideInternal(side);
  };
  const [limitSide, setLimitSide] = useState<"buy" | "sell">("buy");
  const [limitPrice, setLimitPrice] = useState("");
  const [limitAmount, setLimitAmount] = useState("");
  const [limitAmountUnit, setLimitAmountUnit] = useState<"tokens" | "quote">("tokens");
  const [limitStatus, setLimitStatus] = useState("");
  const [limitBusy, setLimitBusy] = useState(false);
  const [outcomeMenuOpen, setOutcomeMenuOpen] = useState(false);
  const outcomeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!slippageOpen) setSlippageDraft(slippageBpsToInput(slippageBps));
  }, [slippageBps, slippageOpen]);

  const commitSlippageDraft = (raw: string = slippageDraft) => {
    const next = slippageInputToBps(raw);
    if (next == null) {
      setSlippageDraft(slippageBpsToInput(slippageBps));
      return;
    }
    onSlippageBpsChange(next);
    setSlippageDraft(slippageBpsToInput(next));
  };

  const labels = outcomeLabels.length > 0 ? outcomeLabels : ["Outcome 0"];
  const balanceNum = walletBalanceWei != null ? Number(formatUnits(walletBalanceWei, collateralDecimals)) : null;
  const balanceFormatted = balanceNum != null
    ? balanceNum.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;
  const isBinary = labels.length === 2 && !hideOutcomeSelector;
  const binaryPcts = useMemo(() => {
    if (!isBinary) return [50, 50];
    const p0 = outcomeChancePcts?.[0];
    const p1 = outcomeChancePcts?.[1];
    if (Number.isFinite(p0) && Number.isFinite(p1)) {
      return [Math.max(0, Math.min(100, p0!)), Math.max(0, Math.min(100, p1!))];
    }
    if (Number.isFinite(p0)) {
      return [p0!, Math.max(0, 100 - p0!)];
    }
    return [50, 50];
  }, [isBinary, outcomeChancePcts]);

  const addMarketAmount = (delta: number) => {
    const cur = Number(amount);
    const next = (Number.isFinite(cur) ? cur : 0) + delta;
    setAmount(next > 0 ? String(Number(next.toFixed(6))) : "");
  };

  const setMarketAmountMax = () => {
    if (marketSide === "sell") {
      void onFillMaxSell?.();
      return;
    }
    if (balanceNum == null || !Number.isFinite(balanceNum)) return;
    setAmount(balanceNum.toFixed(2));
  };
  const tokenBalanceNum = outcomeTokenBalanceWei != null
    ? Number(formatUnits(outcomeTokenBalanceWei, collateralDecimals))
    : null;
  const tokenBalanceFormatted = tokenBalanceNum != null
    ? tokenBalanceNum.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : null;
  const selectedLabel = labels[selectedOutcomeIndex] ?? labels[0] ?? "Outcome";

  const outcomePct = (idx: number) => {
    const raw = outcomeChancePcts?.[idx];
    if (Number.isFinite(raw)) return Math.round(Math.max(0, Math.min(100, raw!)));
    return Math.round(100 / Math.max(labels.length, 1));
  };

  const marketPriceReady = Boolean(priceOfRaw && priceOfRaw > BigInt(0));
  const effectiveMarketSide = marketSellEnabled ? marketSide : "buy";
  const marketCtaLabel = busy
    ? "Processing…"
    : !isWalletConnected
      ? "Sign up to trade"
      : !marketPriceReady
        ? "Loading price…"
        : `${effectiveMarketSide === "sell" ? "Sell" : "Buy"} ${selectedLabel}`;

  const limitTokensNum = useMemo(() => {
    const p = Number(limitPrice);
    const a = Number(limitAmount);
    if (!Number.isFinite(p) || !Number.isFinite(a) || p <= 0 || a <= 0) return null;
    return limitAmountUnit === "tokens" ? a : a / p;
  }, [limitAmount, limitAmountUnit, limitPrice]);

  const limitNotionalNum = useMemo(() => {
    const p = Number(limitPrice);
    const a = Number(limitAmount);
    if (!Number.isFinite(p) || !Number.isFinite(a) || p <= 0 || a <= 0) return null;
    return limitAmountUnit === "tokens" ? p * a : a;
  }, [limitAmount, limitAmountUnit, limitPrice]);

  const limitDerived = useMemo(() => {
    if (limitNotionalNum == null || limitTokensNum == null) {
      return { notionalUsdc: null as string | null, tokens: null as string | null };
    }
    return {
      notionalUsdc: limitNotionalNum.toFixed(2),
      tokens: limitTokensNum.toFixed(4),
    };
  }, [limitNotionalNum, limitTokensNum]);
  const minReceive = useMemo(() => {
    if (!limitDerived.notionalUsdc || !limitDerived.tokens) return null;
    const notional = Number(limitDerived.notionalUsdc);
    const tokens = Number(limitDerived.tokens);
    if (!Number.isFinite(notional) || !Number.isFinite(tokens) || notional <= 0 || tokens <= 0) return null;
    if (limitSide === "sell") {
      const netUsdc = notional * (1 - ORDERBOOK_FEE_BPS / 10000);
      return isUsdStyledCollateralTicker(collateralTicker)
        ? `$${netUsdc.toFixed(2)} ${collateralTicker}`
        : `${netUsdc.toFixed(2)} ${collateralTicker}`;
    }
    return `${tokens.toFixed(1)} tokens`;
  }, [limitDerived.notionalUsdc, limitDerived.tokens, limitSide, collateralTicker]);
  const sellValidationMessage = useMemo(() => {
    if (limitSide !== "sell") return "";
    if (limitTokensNum == null || tokenBalanceNum == null) return "";
    if (limitTokensNum > tokenBalanceNum) {
      if (limitAmountUnit === "tokens") {
        return `Insufficient ${selectedLabel} balance. Max: ${tokenBalanceNum.toFixed(4)} tokens.`;
      }
      const p = Number(limitPrice);
      const maxUsdc = tokenBalanceNum * p;
      return isUsdStyledCollateralTicker(collateralTicker)
        ? `Insufficient ${selectedLabel} balance. Max sell value at this price: $${maxUsdc.toFixed(2)} ${collateralTicker}.`
        : `Insufficient ${selectedLabel} balance. Max sell value at this price: ${maxUsdc.toFixed(2)} ${collateralTicker}.`;
    }
    return "";
  }, [
    limitSide,
    limitTokensNum,
    limitAmountUnit,
    tokenBalanceNum,
    selectedLabel,
    collateralTicker,
    limitPrice,
  ]);

  const buyValidationMessage = useMemo(() => {
    if (limitSide !== "buy") return "";
    if (limitNotionalNum == null || balanceNum == null) return "";
    const totalWithFee = limitNotionalNum * (1 + ORDERBOOK_FEE_BPS / 10000);
    if (totalWithFee > balanceNum) {
      const maxSpend = balanceNum / (1 + ORDERBOOK_FEE_BPS / 10000);
      return isUsdStyledCollateralTicker(collateralTicker)
        ? `Insufficient ${collateralTicker} balance. Max order total: $${maxSpend.toFixed(2)} ${collateralTicker}.`
        : `Insufficient ${collateralTicker} balance. Max order total: ${maxSpend.toFixed(2)} ${collateralTicker}.`;
    }
    return "";
  }, [limitSide, limitNotionalNum, balanceNum, collateralTicker]);

  const limitValidationMessage = sellValidationMessage || buyValidationMessage;
  const limitInputsValid = limitNotionalNum != null && limitTokensNum != null;
  const marketPrice = useMemo(() => {
    if (!priceOfRaw || priceOfRaw <= BigInt(0)) return null;
    const n = Number(formatUnits(priceOfRaw, 18));
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }, [priceOfRaw]);

  const limitPriceLabel = useMemo(() => {
    const p = Number(limitPrice);
    if (!Number.isFinite(p) || p <= 0) return "—";
    return isUsdStyledCollateralTicker(collateralTicker)
      ? `$${p.toFixed(4)}`
      : `${p.toFixed(4)} ${collateralTicker}`;
  }, [limitPrice, collateralTicker]);

  useEffect(() => {
    if (!marketPrice) return;
    const base = limitSide === "sell" ? marketPrice * 0.99 : marketPrice;
    setLimitPrice(base.toFixed(4));
    // Prefill when side/outcome/price context changes; field stays editable.
  }, [limitSide, selectedOutcomeIndex, marketPrice]);

  useEffect(() => {
    if (!outcomeMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!outcomeMenuRef.current?.contains(e.target as Node)) setOutcomeMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [outcomeMenuOpen]);

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
      if (limitSide === "buy" && balanceNum != null) {
        const notional = limitAmountUnit === "tokens" ? priceNum * amountNum : amountNum;
        const totalWithFee = notional * (1 + ORDERBOOK_FEE_BPS / 10000);
        if (totalWithFee > balanceNum) {
          throw new Error(`Insufficient ${collateralTicker} balance for this order.`);
        }
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

  // ── Outcome selector (binary bar + pills; multi picked on page) ─────────
  const outcomeSelector = hideOutcomeSelector ? (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        Outcome
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold text-[var(--foreground)]">{selectedLabel}</p>
    </div>
  ) : isBinary ? (
    <div className="space-y-2.5">
      <BinaryProbabilityPipe yesPct={binaryPcts[0]!} noPct={binaryPcts[1]!} />
      <div className="grid grid-cols-2 gap-2">
        {labels.slice(0, 2).map((label, idx) => {
          const active = idx === selectedOutcomeIndex;
          const isSecond = idx === 1;
          return (
            <button
              key={`${label}-${idx}`}
              type="button"
              onClick={() => onSelectOutcome(idx)}
              className={`flex items-center justify-center rounded-xl py-2 text-center text-sm font-bold transition ${binaryOutcomePillClass(active, isSecond)}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  ) : labels.length > 2 ? (
    <div ref={outcomeMenuRef} className="relative">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        Outcome
      </p>
      <button
        type="button"
        onClick={() => setOutcomeMenuOpen((o) => !o)}
        className="glass-panel-inset flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:ring-1 hover:ring-[var(--accent)]/30"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground)]">
          {selectedLabel}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs font-bold tabular-nums text-[var(--foreground)]">
          {outcomePct(selectedOutcomeIndex)}%
        </span>
        <CaretDown
          size={14}
          weight="bold"
          className={`shrink-0 text-[var(--muted)] transition ${outcomeMenuOpen ? "rotate-180" : ""}`}
        />
      </button>
      {outcomeMenuOpen && (
        <div className="no-scrollbar absolute left-0 right-0 z-30 mt-1.5 max-h-52 overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--glass-inset-bg)] py-1.5 shadow-[var(--glass-shadow)] backdrop-blur-md">
          {labels.map((label, idx) => {
            const active = idx === selectedOutcomeIndex;
            return (
              <button
                key={`${label}-${idx}`}
                type="button"
                onClick={() => {
                  onSelectOutcome(idx);
                  setOutcomeMenuOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-[var(--surface-hover)] ${
                  active ? "bg-[var(--accent)]/10" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]">
                  {label}
                </span>
                <span className="shrink-0 text-xs font-bold tabular-nums text-[var(--muted)]">
                  {outcomePct(idx)}%
                </span>
                {active && (
                  <CheckCircle size={14} weight="fill" className="shrink-0 text-[var(--foreground)]" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  const amountInputMarket = (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <span className="shrink-0 pb-1 text-sm font-medium text-[var(--foreground)]">
          {effectiveMarketSide === "sell" ? "Receive" : "Amount"}
        </span>
        <RightAlignedAmountInput
          value={amount}
          onChange={setAmount}
          showDollar={isUsdStyledCollateralTicker(collateralTicker)}
        />
      </div>
      {effectiveMarketSide === "sell" ? (
        tokenBalanceFormatted != null ? (
          <p className="mb-2 text-[10px] text-[var(--muted)]">
            {selectedLabel} shares{" "}
            <span className="font-mono text-[var(--foreground)]/80">{tokenBalanceFormatted}</span>
          </p>
        ) : null
      ) : balanceFormatted != null ? (
        <p className="mb-2 text-[10px] text-[var(--muted)]">
          Balance{" "}
          <span className="font-mono text-[var(--foreground)]/80">
            {isUsdStyledCollateralTicker(collateralTicker) ? "$" : ""}
            {balanceFormatted}
            {!isUsdStyledCollateralTicker(collateralTicker) ? ` ${collateralTicker}` : ""}
          </span>
        </p>
      ) : null}
      <div className="flex gap-1.5">
        {QUICK_INCREMENTS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => addMarketAmount(q)}
            className="flex-1 rounded-lg bg-[var(--surface)] py-2 text-xs font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            {isUsdStyledCollateralTicker(collateralTicker) ? `+$${q}` : `+${q}`}
          </button>
        ))}
        <button
          type="button"
          onClick={setMarketAmountMax}
          disabled={
            effectiveMarketSide === "sell"
              ? !onFillMaxSell || tokenBalanceNum == null || tokenBalanceNum <= 0
              : balanceNum == null
          }
          className="flex-1 rounded-lg bg-[var(--surface)] py-2 text-xs font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] disabled:opacity-40"
        >
          Max
        </button>
      </div>
    </div>
  );

  const successPanel = tradeSuccess ? (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--outcome-yes)]/15 text-[var(--outcome-yes)]">
        <CheckCircle size={36} weight="fill" />
      </div>
      <h3 className="mt-4 text-lg font-bold text-[var(--foreground)]">Trade complete</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {tradeSuccess.side === "sell"
          ? `You sold ${tradeSuccess.outcomeLabel}`
          : `You bought ${tradeSuccess.outcomeLabel}`}
      </p>
      <div className="mt-5 w-full space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-left">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--muted)]">
            {tradeSuccess.side === "sell" ? "Received" : "Spent"}
          </span>
          <span className="font-semibold tabular-nums text-[var(--foreground)]">{tradeSuccess.amountLabel}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--muted)]">
            {tradeSuccess.side === "sell" ? "Shares sold" : "Shares received"}
          </span>
          <span className="font-semibold tabular-nums text-[var(--foreground)]">{tradeSuccess.sharesLabel}</span>
        </div>
        {tradeSuccess.txHash && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-[var(--muted)]">Receipt</span>
            <a
              href={txExplorerUrl(tradeSuccess.txHash)}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-[10px] text-[var(--foreground)] underline underline-offset-2 hover:opacity-80"
            >
              {tradeSuccess.txHash.slice(0, 10)}…{tradeSuccess.txHash.slice(-8)}
            </a>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismissSuccess?.()}
        className="mt-5 w-full rounded-lg bg-[var(--accent)] py-2.5 text-xs font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.28)] transition hover:brightness-110"
      >
        Done
      </button>
    </div>
  ) : null;

  // ── Panel: single scroll area (CTA scrolls with content) ─────────────────
  const tradeScrollBody = tradeSuccess ? (
    successPanel
  ) : (
    <div className="space-y-3.5">
      {/* Market / Limit + settings */}
      <div className="flex items-center justify-between">
        <div className="flex gap-5">
          {(["market", "limit"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setOrderMode(m);
                if (m !== "market") setSlippageOpen(false);
              }}
              className={`text-sm font-semibold capitalize transition ${
                orderMode === m
                  ? "text-[var(--foreground)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]/75"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {orderMode === "market" && (
          <button
            type="button"
            onClick={() => {
              setSlippageOpen((v) => !v);
              setSlippageDraft(slippageBpsToInput(slippageBps));
            }}
            className={`flex h-8 items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold transition hover:bg-[var(--surface-hover)] ${
              slippageOpen ? "bg-[var(--surface)] text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
            title="Slippage settings"
          >
            <Gear size={16} weight="bold" />
            <span className="tabular-nums">{(slippageBps / 100).toFixed(slippageBps % 100 === 0 ? 0 : 1)}%</span>
          </button>
        )}
      </div>

      {orderMode === "market" && slippageOpen && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-[var(--foreground)]">Slippage tolerance</p>
            <p className="text-[10px] text-[var(--muted)]">Saved as default</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2">
              <input
                type="text"
                inputMode="decimal"
                value={slippageDraft}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^\d.]/g, "");
                  const parts = cleaned.split(".");
                  const next =
                    parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : cleaned;
                  setSlippageDraft(next.slice(0, 6));
                }}
                onBlur={() => commitSlippageDraft()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitSlippageDraft();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-full bg-transparent text-sm font-semibold tabular-nums text-[var(--foreground)] outline-none"
                aria-label="Slippage percent"
              />
              <span className="text-xs font-semibold text-[var(--muted)]">%</span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SLIPPAGE_PRESETS_BPS.map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => {
                  onSlippageBpsChange(bps);
                  setSlippageDraft(slippageBpsToInput(bps));
                }}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold tabular-nums transition ${
                  slippageBps === bps
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {bps % 100 === 0 ? `${bps / 100}%` : `${(bps / 100).toFixed(1)}%`}
              </button>
            ))}
          </div>
        </div>
      )}

      {orderMode === "market" && marketSellEnabled && (
        <div className="flex gap-5">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setMarketSide(s);
                setAmount("");
              }}
              className={`text-sm font-semibold capitalize transition ${
                marketSide === s
                  ? s === "buy"
                    ? "text-[var(--outcome-yes)]"
                    : "text-[var(--outcome-no)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]/75"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {orderMode === "limit" && (
        <div className="flex gap-5">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setLimitSide(s)}
              className={`text-sm font-semibold capitalize transition ${
                limitSide === s
                  ? s === "buy"
                    ? "text-[var(--outcome-yes)]"
                    : "text-[var(--outcome-no)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]/75"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {outcomeSelector}

      {orderMode === "market" ? (
        <>
          {amountInputMarket}
          <TradeSummaryBox
            rows={
              effectiveMarketSide === "sell"
                ? [
                    {
                      label: `Est. receive`,
                      value: collateralFormatted
                        ? isUsdStyledCollateralTicker(collateralTicker)
                          ? `$${collateralFormatted} ${collateralTicker}`
                          : `${collateralFormatted} ${collateralTicker}`
                        : "—",
                      valueClass: "font-semibold text-[var(--trade-highlight)]",
                    },
                    {
                      label: "Shares sold",
                      value: tokensFormatted ?? "—",
                      valueClass: "font-semibold text-[var(--muted)]",
                    },
                    {
                      label: "Price / share",
                      value: pricePerTokenLabel ?? "—",
                      valueClass: "font-semibold text-[var(--foreground)]",
                    },
                    {
                      label: "Slippage",
                      value: `${(slippageBps / 100).toFixed(slippageBps % 100 === 0 ? 0 : 1)}%`,
                      valueClass: "font-semibold text-[var(--muted)]",
                    },
                  ]
                : [
                    {
                      label: "Est. shares",
                      value: tokensFormatted ?? "—",
                      valueClass: "font-semibold text-[var(--muted)]",
                    },
                    {
                      label: "Price / share",
                      value: pricePerTokenLabel ?? "—",
                      valueClass: "font-semibold text-[var(--foreground)]",
                    },
                    {
                      label: "Slippage",
                      value: `${(slippageBps / 100).toFixed(slippageBps % 100 === 0 ? 0 : 1)}%`,
                      valueClass: "font-semibold text-[var(--muted)]",
                    },
                  ]
            }
          />
          {status &&
            !/^(Preparing trade|Approve collateral|Submitting trade)/i.test(status.trim()) && (
              <p className="text-center text-[10px] text-[var(--muted)]">{status}</p>
            )}
          <button
            type="button"
            onClick={() => onSubmit(effectiveMarketSide)}
            disabled={busy || tradeDisabled || !marketPriceReady}
            className={`w-full rounded-xl py-3.5 text-center text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
              effectiveMarketSide === "sell"
                ? "bg-[var(--outcome-no)] hover:bg-[var(--outcome-no-hover)]"
                : "bg-[var(--outcome-yes)] hover:bg-[var(--outcome-yes-hover)]"
            }`}
          >
            {tradeDisabled ? "Trading closed" : marketCtaLabel}
          </button>
        </>
      ) : (
        <>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-end justify-between gap-3">
                <span className="shrink-0 text-sm font-medium text-[var(--foreground)]">Price</span>
                <RightAlignedAmountInput
                  value={limitPrice}
                  onChange={setLimitPrice}
                  placeholder="0.50"
                  textSizeClass="text-2xl"
                  valueColorClass="text-[var(--foreground)]"
                  showDollar={isUsdStyledCollateralTicker(collateralTicker)}
                />
              </div>
              <p className="text-[10px] text-[var(--muted)]">
                Market{" "}
                <span className="font-mono tabular-nums text-[var(--foreground)]/85">
                  {marketPrice != null
                    ? isUsdStyledCollateralTicker(collateralTicker)
                      ? `$${marketPrice.toFixed(4)}`
                      : `${marketPrice.toFixed(4)} ${collateralTicker}`
                    : "—"}
                </span>
              </p>
            </div>
            <div>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div className="flex min-w-0 shrink items-center gap-2">
                  <span className="text-sm font-medium text-[var(--foreground)]">Amount</span>
                  <button
                    type="button"
                    onClick={() => setLimitAmountUnit((u) => (u === "tokens" ? "quote" : "tokens"))}
                    className="inline-flex items-center gap-1 rounded-md bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                    title="Switch amount unit"
                  >
                    <ArrowsClockwise size={10} weight="bold" />
                    {limitAmountUnit === "tokens" ? "Tokens" : collateralTicker}
                  </button>
                </div>
                <RightAlignedAmountInput
                  value={limitAmount}
                  onChange={setLimitAmount}
                  placeholder="0"
                  textSizeClass="text-2xl"
                  valueColorClass="text-[var(--foreground)]"
                  showDollar={limitAmountUnit === "quote" && isUsdStyledCollateralTicker(collateralTicker)}
                />
              </div>
              <p className="text-[10px] text-[var(--muted)]">
                Balance{" "}
                <span className="font-mono tabular-nums text-[var(--foreground)]/85">
                  {limitAmountUnit === "tokens"
                    ? (tokenBalanceFormatted ?? "—")
                    : isUsdStyledCollateralTicker(collateralTicker)
                      ? `$${balanceFormatted ?? "—"}`
                      : `${balanceFormatted ?? "—"} ${collateralTicker}`}
                </span>
              </p>
              {limitValidationMessage && (
                <p className="mt-1 text-[10px] text-[var(--outcome-no)]">{limitValidationMessage}</p>
              )}
            </div>
            <TradeSummaryBox
              rows={[
                {
                  label: "Est. shares",
                  value: limitDerived.tokens ?? "—",
                  valueClass: "font-semibold text-[var(--muted)]",
                },
                {
                  label: "Min receive (at limit)",
                  value: minReceive ?? "—",
                  valueClass: minReceive
                    ? "font-semibold text-[var(--trade-highlight)]"
                    : "font-semibold text-[var(--muted)]",
                },
                {
                  label: "Price / share",
                  value: limitPriceLabel,
                  valueClass: "font-semibold text-[var(--foreground)]",
                },
              ]}
            />
          </div>
          {limitStatus && <p className="text-center text-[10px] text-[var(--muted)]">{limitStatus}</p>}
          <button
            type="button"
            disabled={limitBusy || !onSubmitLimit || !limitInputsValid || Boolean(limitValidationMessage)}
            onClick={() => void handleLimitSubmit()}
            className={`w-full rounded-xl py-3.5 text-sm font-bold text-white transition disabled:opacity-40 ${
              limitSide === "buy"
                ? "bg-[var(--outcome-yes)] hover:bg-[var(--outcome-yes-hover)]"
                : "bg-[var(--outcome-no)] hover:bg-[var(--outcome-no-hover)]"
            }`}
          >
            {limitBusy ? "Submitting…" : `${limitSide === "buy" ? "Buy" : "Sell"} ${selectedLabel}`}
          </button>
        </>
      )}
    </div>
  );

  const tradePanelLayout = (
    <div className="trade-panel-scroll no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tradeScrollBody}
    </div>
  );

  // ── Inline mode ──────────────────────────────────────────────────────────
  if (inline) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {tradePanelLayout}
        {belowPanel ? (
          <div className="no-scrollbar max-h-[min(42%,18rem)] shrink-0 overflow-y-auto border-t border-[var(--border)] px-4 py-3">
            {belowPanel}
          </div>
        ) : null}
      </div>
    );
  }

  const isSheet = presentation === "sheet";

  const modalHeader = (
    <div className="shrink-0 px-4 pb-3 pt-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 id="trade-modal-title" className="line-clamp-2 text-sm font-semibold tracking-tight text-[var(--foreground)]">
              {marketTitle}
            </h2>
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide
              ${selectedOutcomeIndex === 0
                ? "border-[var(--outcome-yes)]/35 bg-[var(--outcome-yes)]/10 text-[var(--outcome-yes)]"
                : selectedOutcomeIndex === 1
                  ? "border-[var(--outcome-no)]/35 bg-[var(--outcome-no)]/10 text-[var(--outcome-no)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}
            >
              {selectedLabel.toUpperCase()}
            </span>
          </div>
          {priceRangeLine && (
            <p className="mt-1 text-base font-semibold tabular-nums text-[var(--foreground)]">{priceRangeLine}</p>
          )}
          <p className="mt-1 text-[10px] leading-snug text-[var(--muted)]">
            Staking ends <span className="text-[var(--foreground)]/90">{stakeEnds}</span>
            <span className="mx-1.5 text-[var(--border)]">·</span>
            Expires{" "}
            <span
              className="cursor-default text-[var(--foreground)]/90"
              title={resolveAfterTooltip || undefined}
            >
              {resolveAfter}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full p-1 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          aria-label="Close"
        >
          <X size={18} weight="bold" />
        </button>
      </div>
    </div>
  );

  // ── Modal / sheet overlay ────────────────────────────────────────────────
  return (
    <div
      className={
        isSheet
          ? "fixed inset-0 z-50 flex flex-col justify-end bg-[var(--overlay-scrim)] backdrop-blur-[2px] md:items-center md:justify-center md:p-3"
          : "fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay-scrim)] p-3 backdrop-blur-[2px] md:items-center"
      }
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className={
          isSheet
            ? "trade-sheet-panel relative flex max-h-[min(92dvh,44rem)] min-h-0 w-full flex-col overflow-hidden rounded-t-2xl bg-[var(--card)] shadow-[var(--elevated-card-shadow)] md:max-w-[400px] md:rounded-3xl"
            : "relative flex min-h-0 w-full max-w-[400px] max-h-[min(92dvh,44rem)] flex-col overflow-hidden rounded-3xl bg-[var(--card)] shadow-[var(--elevated-card-shadow)]"
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {modalHeader}
        {tradePanelLayout}
        {belowPanel ? (
          <div className="no-scrollbar max-h-[40%] shrink-0 overflow-y-auto border-t border-[var(--border)] px-4 py-3">
            {belowPanel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

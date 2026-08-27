"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CheckCircle, X } from "@phosphor-icons/react";
import { ETH_COINGECKO_LOGO } from "@/lib/brand-assets";
import { NATIVE_CURRENCY_SYMBOL, txExplorerUrl } from "@/lib/chain";

type CreateConfirmModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
  confirmLabel: string;
  seedAmountLabel: string;
  collateralSymbol: string;
  collateralLogo: string;
  collateralBalanceLabel: string;
  gasEstimateLabel: string;
  ethBalanceLabel: string;
  seedShortfall: boolean;
  ethGasShortfall: boolean;
  balancesReady?: boolean;
  error?: string | null;
  success?: {
    marketAddress?: string;
    txHash: string;
    title?: string;
  } | null;
};

function TokenIcon({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="h-5 w-5 rounded-full object-cover" />
  );
}

export function CreateConfirmModal({
  open,
  onClose,
  onConfirm,
  confirming,
  confirmLabel,
  seedAmountLabel,
  collateralSymbol,
  collateralLogo,
  collateralBalanceLabel,
  gasEstimateLabel,
  ethBalanceLabel,
  seedShortfall,
  ethGasShortfall,
  balancesReady = true,
  error,
  success,
}: CreateConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirming) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirming, onClose]);

  if (!open) return null;

  if (success) {
    const marketHref = success.marketAddress
      ? `/market/${success.marketAddress}`
      : "/market";
    const shortMarket = success.marketAddress
      ? `${success.marketAddress.slice(0, 6)}…${success.marketAddress.slice(-4)}`
      : "Indexed on-chain";
    const shortTx = `${success.txHash.slice(0, 10)}…${success.txHash.slice(-8)}`;
    return (
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 backdrop-blur-[2px]"
        onClick={onClose}
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-success-title"
          className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col items-center px-5 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle size={36} weight="fill" />
            </div>
            <h3 id="create-success-title" className="mt-4 text-lg font-bold text-[var(--foreground)]">
              Market created
            </h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {success.title?.trim() || "Your market is live and seeded."}
            </p>

            <div className="mt-5 w-full space-y-2 rounded-xl border border-[var(--border)] bg-[var(--background)]/60 px-3 py-3 text-left">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[var(--muted)]">Seeded</span>
                <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-[var(--foreground)]">
                  <TokenIcon src={collateralLogo} alt={collateralSymbol} />
                  {seedAmountLabel} {collateralSymbol}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[var(--muted)]">Market</span>
                <span className="font-mono text-[10px] text-[var(--foreground)]">{shortMarket}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[var(--muted)]">Receipt</span>
                <a
                  href={txExplorerUrl(success.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-[10px] text-[var(--foreground)] underline underline-offset-2 hover:opacity-80"
                >
                  {shortTx}
                </a>
              </div>
            </div>

            <div className="mt-5 flex w-full gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-full border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--background)]"
              >
                Done
              </button>
              <Link
                href={marketHref}
                className="flex flex-1 items-center justify-center rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
              >
                View market
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 backdrop-blur-[2px]"
      onClick={() => {
        if (!confirming) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-confirm-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h3 id="create-confirm-title" className="text-base font-semibold text-[var(--foreground)]">
            Confirm market
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]/60 px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  Seed liquidity
                </p>
                <p className="mt-1.5 flex items-center gap-2 text-lg font-semibold tabular-nums text-[var(--foreground)]">
                  <TokenIcon src={collateralLogo} alt={collateralSymbol} />
                  {seedAmountLabel} {collateralSymbol}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  Balance
                </p>
                <p
                  className={`mt-1.5 text-sm font-medium tabular-nums ${
                    seedShortfall ? "text-red-400" : "text-[var(--foreground)]"
                  }`}
                >
                  {collateralBalanceLabel} {collateralSymbol}
                </p>
              </div>
            </div>
            {seedShortfall && (
              <p className="mt-3 text-xs leading-relaxed text-red-400">
                Insufficient {collateralSymbol} for this seed amount.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]/60 px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  Network fee
                </p>
                <p className="mt-1.5 flex items-center gap-2 text-lg font-semibold tabular-nums text-[var(--foreground)]">
                  <TokenIcon src={ETH_COINGECKO_LOGO} alt={NATIVE_CURRENCY_SYMBOL} />
                  ~{gasEstimateLabel || "—"} {NATIVE_CURRENCY_SYMBOL}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  ETH balance
                </p>
                <p
                  className={`mt-1.5 text-sm font-medium tabular-nums ${
                    ethGasShortfall ? "text-red-400" : "text-[var(--foreground)]"
                  }`}
                >
                  {ethBalanceLabel || "—"} {NATIVE_CURRENCY_SYMBOL}
                </p>
              </div>
            </div>
            {ethGasShortfall && (
              <p className="mt-3 text-xs leading-relaxed text-red-400">
                Insufficient {NATIVE_CURRENCY_SYMBOL} to cover the network fee.
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-400">
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-3 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="flex-1 rounded-full border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--background)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={
              confirming ||
              seedShortfall ||
              ethGasShortfall ||
              !gasEstimateLabel ||
              !balancesReady
            }
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirming ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                {confirmLabel}
              </>
            ) : (
              "Confirm create"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

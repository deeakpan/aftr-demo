"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CopySimple, ShareNetwork, X } from "@phosphor-icons/react";
import { DEPLOYMENT_NETWORK_LABEL, NATIVE_CURRENCY_SYMBOL } from "@/lib/chain";
import { copyFromTextField, copyTextToClipboard, shareText } from "@/lib/clipboard";

type DepositModalProps = {
  address: `0x${string}`;
  onClose: () => void;
};

export function DepositModal({ address, onClose }: DepositModalProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&bgcolor=3a3a3a&color=ffffff&qzone=2&data=${encodeURIComponent(address)}`;

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    };
  }, [onClose]);

  const markCopied = () => {
    setCopyError(false);
    setCopied(true);
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
  };

  const handleCopy = () => {
    setCopyError(false);

    // 1) Copy from the visible field (most reliable on iOS).
    const field = addressInputRef.current;
    if (field && copyFromTextField(field)) {
      markCopied();
      return;
    }

    // 2) Clipboard API + iOS-tuned execCommand fallback.
    void copyTextToClipboard(address).then((ok) => {
      if (ok) {
        markCopied();
        return;
      }
      setCopied(false);
      setCopyError(true);
    });
  };

  const handleShare = () => {
    void shareText(address, "Deposit address").then((ok) => {
      if (ok) {
        // iOS share sheet often used to Copy — treat as success feedback.
        markCopied();
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col justify-end bg-black/60 backdrop-blur-[2px] md:items-center md:justify-center md:px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="trade-sheet-panel w-full rounded-t-3xl bg-[#2a2a2a] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] md:max-w-sm md:rounded-3xl md:p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-modal-title"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 md:hidden" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h3 id="deposit-modal-title" className="text-lg font-semibold text-white">
            Deposit
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-neutral-400">
          Send USDG or {NATIVE_CURRENCY_SYMBOL} on {DEPLOYMENT_NETWORK_LABEL} to this address. This is the
          wallet you trade from.
        </p>
        <div className="mb-4 flex justify-center rounded-2xl bg-[#3a3a3a] p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            alt="Deposit address QR code"
            width={180}
            height={180}
            className="h-[180px] w-[180px] rounded-xl"
          />
        </div>

        {/* Visible readonly field — iOS can select/copy this natively. */}
        <input
          ref={addressInputRef}
          type="text"
          readOnly
          value={address}
          onFocus={(e) => {
            const el = e.currentTarget;
            requestAnimationFrame(() => el.setSelectionRange(0, el.value.length));
          }}
          className="mb-3 w-full rounded-2xl border border-white/10 bg-[#3a3a3a] px-3.5 py-3.5 font-mono text-[12px] leading-relaxed text-white outline-none selection:bg-white/30"
          aria-label="Deposit address"
          inputMode="text"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCopy();
            }}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-bold text-black touch-manipulation active:bg-neutral-200"
            aria-label={copied ? "Address copied" : "Copy deposit address"}
          >
            {copied ? <Check size={18} weight="bold" className="text-emerald-600" /> : <CopySimple size={18} weight="bold" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {canShare ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleShare();
              }}
              className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#3a3a3a] px-4 text-sm font-semibold text-white touch-manipulation active:bg-[#444]"
              aria-label="Share deposit address"
            >
              <ShareNetwork size={18} weight="bold" />
              Share
            </button>
          ) : null}
        </div>

        <p className="mt-2.5 text-center text-[11px] text-neutral-500">
          {copied
            ? "Address copied"
            : copyError
              ? "Select the address above, then Copy — or use Share"
              : "Tap Copy, or long-press the address"}
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Check, CopySimple, X } from "@phosphor-icons/react";
import { DEPLOYMENT_NETWORK_LABEL, NATIVE_CURRENCY_SYMBOL } from "@/lib/chain";
import { copyTextToClipboard } from "@/lib/clipboard";

type DepositModalProps = {
  address: `0x${string}`;
  onClose: () => void;
};

export function DepositModal({ address, onClose }: DepositModalProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&bgcolor=3a3a3a&color=ffffff&qzone=2&data=${encodeURIComponent(address)}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    setCopyError(false);
    const ok = await copyTextToClipboard(address);
    if (!ok) {
      setCopyError(true);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
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
        <button
          type="button"
          onClick={() => void copy()}
          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-[#3a3a3a] px-3.5 py-3 text-left active:bg-[#444]"
        >
          <span className="min-w-0 break-all font-mono text-xs text-white select-all">{address}</span>
          {copied ? (
            <Check size={16} weight="bold" className="shrink-0 text-emerald-400" />
          ) : (
            <CopySimple size={16} weight="bold" className="shrink-0 text-neutral-400" />
          )}
        </button>
        <p className="mt-2.5 text-center text-[11px] text-neutral-500">
          {copied ? "Copied" : copyError ? "Copy failed — long-press the address to copy" : "Tap to copy"}
        </p>
      </div>
    </div>
  );
}

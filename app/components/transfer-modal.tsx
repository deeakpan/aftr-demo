"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowsLeftRight, CircleNotch, X } from "@phosphor-icons/react";
import {
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
  formatUnits,
} from "viem";
import { usePublicClient } from "wagmi";
import { USDG_TOKEN_LOGO } from "@/lib/brand-assets";
import { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL, wrongNetworkMessage } from "@/lib/deployment";
import { useSessionWallet } from "@/lib/session-wallet";
import { formatUserTxError } from "@/lib/tx-error";
import { txExplorerUrl } from "@/lib/chain";

const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

type TransferModalProps = {
  tokenAddress: `0x${string}`;
  balanceWei: bigint;
  decimals: number;
  ticker?: string;
  onClose: () => void;
  onSuccess?: () => void;
};

function sanitizeAmount(raw: string) {
  let cleaned = raw.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) cleaned = `${parts[0]}.${parts.slice(1).join("")}`;
  return cleaned.slice(0, 24);
}

export function TransferModal({
  tokenAddress,
  balanceWei,
  decimals,
  ticker = "USDG",
  onClose,
  onSuccess,
}: TransferModalProps) {
  const publicClient = usePublicClient({ chainId: DEPLOYMENT_CHAIN_ID });
  const { address, chainId, writeContract } = useSessionWallet();
  const [toInput, setToInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const balanceLabel = useMemo(() => {
    try {
      return Number(formatUnits(balanceWei, decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      });
    } catch {
      return "0";
    }
  }, [balanceWei, decimals]);

  const toAddress = useMemo(() => {
    const t = toInput.trim();
    if (!isAddress(t)) return null;
    try {
      return getAddress(t) as `0x${string}`;
    } catch {
      return null;
    }
  }, [toInput]);

  const amountWei = useMemo(() => {
    const t = amountInput.trim();
    if (!t || !Number.isFinite(Number(t)) || Number(t) <= 0) return null;
    try {
      return parseUnits(t, decimals);
    } catch {
      return null;
    }
  }, [amountInput, decimals]);

  const validationError = useMemo(() => {
    if (toInput.trim() && !toAddress) return "Enter a valid 0x address.";
    if (toAddress && address && toAddress.toLowerCase() === address.toLowerCase()) {
      return "Cannot transfer to your own wallet.";
    }
    if (amountInput.trim() && amountWei === null) return "Enter a valid amount.";
    if (amountWei !== null && amountWei > balanceWei) return "Amount exceeds balance.";
    return null;
  }, [toInput, toAddress, address, amountInput, amountWei, balanceWei]);

  const canSubmit =
    Boolean(address && toAddress && amountWei && amountWei > BigInt(0) && !validationError && !busy && !txHash);

  const submit = async () => {
    if (!address || !toAddress || !amountWei) return;
    if (chainId !== DEPLOYMENT_CHAIN_ID) {
      setStatusIsError(true);
      setStatus(wrongNetworkMessage());
      return;
    }
    if (validationError) {
      setStatusIsError(true);
      setStatus(validationError);
      return;
    }
    try {
      setBusy(true);
      setStatusIsError(false);
      setStatus("Sending…");
      const hash = await writeContract({
        address: tokenAddress,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [toAddress, amountWei],
        account: address,
        gas: BigInt(120_000),
      });
      setTxHash(hash);
      setStatus("Transfer sent.");
      if (publicClient) {
        try {
          await publicClient.waitForTransactionReceipt({ hash });
          setStatus("Transfer confirmed.");
        } catch {
          /* hash is enough */
        }
      }
      onSuccess?.();
      window.setTimeout(() => onClose(), 1400);
    } catch (e) {
      setStatusIsError(true);
      setStatus(formatUserTxError(e, "Transfer failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col justify-end bg-black/60 backdrop-blur-[2px] md:items-center md:justify-center md:px-4"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        className="trade-sheet-panel w-full rounded-t-3xl bg-[#2a2a2a] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] md:max-w-sm md:rounded-3xl md:p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-modal-title"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 md:hidden" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h3 id="transfer-modal-title" className="flex items-center gap-2 text-lg font-semibold text-white">
            <ArrowsLeftRight size={18} weight="bold" />
            Transfer
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
            aria-label="Close"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-neutral-400">
          Send {ticker} on {DEPLOYMENT_NETWORK_LABEL} from your trading wallet.
        </p>

        <div className="mb-3 flex items-center justify-between rounded-2xl bg-[#3a3a3a] px-3.5 py-2.5 text-xs text-neutral-300">
          <span className="inline-flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={USDG_TOKEN_LOGO} alt="" width={16} height={16} className="h-4 w-4 rounded-full" />
            Balance
          </span>
          <span className="tabular-nums text-white">
            {balanceLabel} {ticker}
          </span>
        </div>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          To address
        </label>
        <input
          value={toInput}
          onChange={(e) => {
            setToInput(e.target.value);
            setStatus("");
            setStatusIsError(false);
          }}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          disabled={busy || Boolean(txHash)}
          className="mb-3 w-full rounded-2xl border border-white/10 bg-[#3a3a3a] px-3.5 py-3 font-mono text-xs text-white outline-none placeholder:text-neutral-500 focus:border-white/25 disabled:opacity-60"
        />

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Amount ({ticker})
        </label>
        <div className="mb-2 flex gap-2">
          <input
            value={amountInput}
            onChange={(e) => {
              setAmountInput(sanitizeAmount(e.target.value));
              setStatus("");
              setStatusIsError(false);
            }}
            inputMode="decimal"
            placeholder="0.00"
            disabled={busy || Boolean(txHash)}
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#3a3a3a] px-3.5 py-3 text-sm tabular-nums text-white outline-none placeholder:text-neutral-500 focus:border-white/25 disabled:opacity-60"
          />
          <button
            type="button"
            disabled={busy || Boolean(txHash) || balanceWei <= BigInt(0)}
            onClick={() => setAmountInput(formatUnits(balanceWei, decimals))}
            className="shrink-0 rounded-2xl bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-40"
          >
            Max
          </button>
        </div>

        {validationError ? (
          <p className="mb-3 text-[12px] text-red-400">{validationError}</p>
        ) : (
          <p className="mb-3 text-[11px] text-neutral-500">Double-check the address — transfers can’t be reversed.</p>
        )}

        {status ? (
          <p className={`mb-3 text-center text-[12px] ${statusIsError ? "text-red-400" : "text-emerald-400"}`}>
            {status}
            {txHash ? (
              <>
                {" "}
                <a
                  href={txExplorerUrl(txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  View tx
                </a>
              </>
            ) : null}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-bold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <>
              <CircleNotch size={16} className="animate-spin" />
              Sending…
            </>
          ) : (
            `Send ${ticker}`
          )}
        </button>
      </div>
    </div>
  );
}

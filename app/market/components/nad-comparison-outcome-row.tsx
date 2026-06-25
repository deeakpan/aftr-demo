"use client";

import { formatNadMcapUsd } from "@/lib/nad/market-stats";
import {
  MARKET_CARD_MULTI_PCT_CLASS,
  MARKET_CARD_MULTI_ROW_CLASS,
} from "@/app/market/components/market-list-card";

type Props = {
  symbol: string;
  imageUri?: string;
  mcapUsd: number | null;
  chancePct: number;
  loading?: boolean;
  onClick?: () => void;
  interactive?: boolean;
  tradingClosed?: boolean;
  active?: boolean;
};

export function NadComparisonOutcomeRow({
  symbol,
  imageUri,
  mcapUsd,
  chancePct,
  loading = false,
  onClick,
  interactive = true,
  tradingClosed = false,
  active = false,
}: Props) {
  const row = (
    <>
      {imageUri ? (
        <img
          src={imageUri}
          alt=""
          className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
        />
      ) : (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[9px] font-bold text-[var(--muted)] ring-1 ring-[var(--border)]">
          {symbol.slice(0, 2)}
        </span>
      )}
      <span className="w-[5.25rem] shrink-0 truncate text-left text-[12px] font-semibold text-[var(--foreground)]">
        ${symbol}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-[11px] tabular-nums text-[var(--muted)]">
        {loading ? "…" : formatNadMcapUsd(mcapUsd)}
      </span>
      <span className={MARKET_CARD_MULTI_PCT_CLASS}>{Math.round(chancePct)}%</span>
    </>
  );

  const className = `${MARKET_CARD_MULTI_ROW_CLASS} w-full transition ${
    active ? "bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/30" : ""
  } ${interactive && !tradingClosed && onClick ? "cursor-pointer hover:bg-[var(--surface-hover)]" : "opacity-80"}`;

  if (onClick && interactive && !tradingClosed) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} className={className}>
        {row}
      </button>
    );
  }

  return <div className={className}>{row}</div>;
}

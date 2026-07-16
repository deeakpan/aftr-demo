"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise, BookmarkSimple, CircleNotch, PlusMinus } from "@phosphor-icons/react";
import { formatUnits, parseAbi, parseEventLogs } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import deployment, { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL, wrongNetworkMessage } from "@/lib/deployment";
import { collateralTickerFromDeployment } from "@/lib/deployment-collateral";
import {
  BinaryProbabilityPipe,
  binaryOutcomePillClass,
  MARKET_CARD_MULTI_LABEL_CLASS,
  MARKET_CARD_MULTI_ROW_CLASS,
  MARKET_CARD_OUTCOMES_BOX,
  MARKET_CARD_TRADES_BODY_CLASS,
  MARKET_CARD_TRADES_FOOTER_SLOT_CLASS,
  MARKET_CARD_TRADES_GRID_CLASS,
  MARKET_CARD_TRADES_META_CLASS,
  MARKET_CARD_TRADES_SHELL_CLASS,
  MARKET_CARD_TRADES_TITLE_CLASS,
} from "@/app/market/components/market-list-card";
import {
  NadMarketCardCover,
  nadOutcomeDisplayLabel,
  nadTokenForOutcome,
} from "@/app/market/components/nad-market-list-card";
import type { NadMarketConfig } from "@/lib/nad/types";
import { MARKET_COVER_ASPECT_CLASS } from "@/lib/market-cover";

const MARKET_ABI = parseAbi([
  "function marketKind() view returns (uint8)",
  "function state() view returns (uint8)",
  "function stakeEndTimestamp() view returns (uint256)",
  "function numOutcomes() view returns (uint8)",
  "function outcomeToken(uint256) view returns (address)",
  "function collateralAddress() view returns (address)",
  "function collateralDecimals() view returns (uint8)",
  "function winningOutcomeIndex() view returns (uint256)",
  "function redemptionRate() view returns (uint256)",
  "function metadataURI() view returns (string)",
  "function priceOf(uint8 outcomeIndex) view returns (uint256)",
  "function realPool(uint256 outcomeIndex) view returns (uint256)",
  "function redeem(uint8 outcomeIndex, uint256 shareAmount)",
  "event TokensRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout)",
]);
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

type PositionRow = {
  marketAddress: `0x${string}`;
  collateralAddress: `0x${string}`;
  marketTitle: string;
  marketKind: "Event" | "Price" | "Nad";
  marketState: number;
  stakeEndUnix: number;
  winningOutcomeIndex: number | null;
  redemptionRate: bigint;
  outcomeIndex: number;
  outcomeLabel: string;
  outcomeLabels: string[];
  balance: bigint;
  collateralDecimals: number;
  chancePct: number;
  outcomeChancePcts: number[];
  poolTvlDisplay: string;
  stakeEndsLabel: string;
  imageUrl: string;
  indexedCollateralIn: bigint;
  indexedCollateralOut: bigint;
  /** Synthetic row after claim — no ERC20 balance left */
  settlementDisplay?: "claimed" | "settled_no_shares";
  nadMarket?: NadMarketConfig | null;
};


type MarketPositionGroup = {
  marketAddress: `0x${string}`;
  collateralAddress: `0x${string}`;
  marketTitle: string;
  marketKind: "Event" | "Price" | "Nad";
  marketState: number;
  stakeEndUnix: number;
  winningOutcomeIndex: number | null;
  redemptionRate: bigint;
  outcomeLabels: string[];
  chancePct: number;
  outcomeChancePcts: number[];
  poolTvlDisplay: string;
  stakeEndsLabel: string;
  imageUrl: string;
  nadMarket?: NadMarketConfig | null;
  collateralDecimals: number;
  indexedCollateralIn: bigint;
  indexedCollateralOut: bigint;
  settlementDisplay?: "claimed" | "settled_no_shares";
  /** Open shares per outcome, plus synthetic settled rows with zero balance */
  positions: { outcomeIndex: number; outcomeLabel: string; balance: bigint }[];
};

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, v));
}

function formatShareAmount(raw: bigint, decimals: number): string {
  const s = formatUnits(raw, decimals);
  const n = Number(s);
  if (!Number.isFinite(n)) return `${s} shares`;
  return `${formatCompactCount(n)} shares`;
}

/** Compact display for share counts: 1k, 1.2k, 10k, 20k, etc. */
function formatCompactCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return v >= 10 ? `${Math.round(v)}M` : `${trimTrailingZero(v.toFixed(1))}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return v >= 10 ? `${Math.round(v)}k` : `${trimTrailingZero(v.toFixed(1))}k`;
  }
  if (n >= 100) return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function trimTrailingZero(s: string) {
  return s.replace(/\.0$/, "");
}

function formatCompactSharesInline(raw: bigint, decimals: number): string | null {
  const n = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(n) || n <= 0) return null;
  return formatCompactCount(n);
}

function fmtTs(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

function stateLabel(state: number, stakeEndUnix: number) {
  if (state === 2) return "Settled";
  if (state === 1) return "Resolving";
  const now = Math.floor(Date.now() / 1000);
  if (now >= stakeEndUnix) return "Trading closed";
  return "Open";
}

/** Turn long viem/MetaMask errors into something users can read. */
function friendlyWalletError(e: unknown): string {
  const raw =
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
      ? (e as Error).message
      : typeof e === "string"
        ? e
        : "";
  const lower = raw.toLowerCase();
  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("denied transaction signature") ||
    (lower.includes("reject") && lower.includes("signature")) ||
    lower.includes("user_cancelled") ||
    lower.includes("action_rejected")
  ) {
    return "You closed or rejected the wallet prompt. Nothing was sent on-chain — try again when you’re ready.";
  }
  if (lower.includes("insufficient funds") && lower.includes("gas")) {
    return `Not enough MON on ${DEPLOYMENT_NETWORK_LABEL} to pay gas.`;
  }
  const first = raw.split("\n")[0]?.split("Contract Call:")[0]?.trim() ?? "";
  if (first && first.length <= 180) return first;
  return "Transaction didn’t go through. Try again, or switch network and retry.";
}

function groupRows(rows: PositionRow[]): MarketPositionGroup[] {
  const byMarket = new Map<string, PositionRow[]>();
  for (const row of rows) {
    const k = row.marketAddress.toLowerCase();
    const list = byMarket.get(k) ?? [];
    list.push(row);
    byMarket.set(k, list);
  }
  const groups: MarketPositionGroup[] = [];
  for (const list of byMarket.values()) {
    const head = list[0]!;
    // Indexed amounts are per-market (duplicated on each outcome row), not per-outcome.
    const indexedCollateralIn = head.indexedCollateralIn;
    const indexedCollateralOut = head.indexedCollateralOut;
    const settlementDisplay = list.find((r) => r.settlementDisplay)?.settlementDisplay;
    groups.push({
      marketAddress: head.marketAddress,
      collateralAddress: head.collateralAddress,
      marketTitle: head.marketTitle,
      marketKind: head.marketKind,
      marketState: head.marketState,
      stakeEndUnix: head.stakeEndUnix,
      winningOutcomeIndex: head.winningOutcomeIndex,
      redemptionRate: head.redemptionRate,
      outcomeLabels: head.outcomeLabels,
      chancePct: head.chancePct,
      outcomeChancePcts: head.outcomeChancePcts,
      poolTvlDisplay: head.poolTvlDisplay,
      stakeEndsLabel: head.stakeEndsLabel,
      imageUrl: head.imageUrl,
      nadMarket: head.nadMarket,
      collateralDecimals: head.collateralDecimals,
      indexedCollateralIn,
      indexedCollateralOut,
      settlementDisplay,
      positions: list.map((r) => ({
        outcomeIndex: r.outcomeIndex,
        outcomeLabel: r.outcomeLabel,
        balance: r.balance,
      })),
    });
  }
  return groups;
}

function balanceForOutcome(
  positions: MarketPositionGroup["positions"],
  outcomeIndex: number,
): bigint {
  const hit = positions.find((p) => p.outcomeIndex === outcomeIndex);
  return hit?.balance ?? BigInt(0);
}

function OpenPositionHoldings({
  labels,
  positions,
  collateralDecimals,
  outcomeChancePcts,
  tradingClosed,
  nadMarket,
}: {
  labels: string[];
  positions: MarketPositionGroup["positions"];
  collateralDecimals: number;
  outcomeChancePcts: number[];
  tradingClosed: boolean;
  nadMarket?: NadMarketConfig | null;
}) {
  const displayLabel = (label: string, idx: number) =>
    nadMarket ? nadOutcomeDisplayLabel(nadMarket, label) : label;

  const isBinary = labels.length === 2;
  const yesPct = clampPct(outcomeChancePcts[0] ?? 50);
  const noPct = clampPct(outcomeChancePcts[1] ?? 50);

  if (isBinary) {
    return (
      <div className={`${MARKET_CARD_OUTCOMES_BOX} justify-center gap-2.5`}>
        <BinaryProbabilityPipe yesPct={yesPct} noPct={noPct} />
        <div className="grid grid-cols-2 gap-2">
          {labels.slice(0, 2).map((label, idx) => {
            const bal = balanceForOutcome(positions, idx);
            const isNo = idx === 1;
            const hasShares = bal > BigInt(0);
            const shareLabel = formatCompactSharesInline(bal, collateralDecimals);
            return (
              <div
                key={`${label}-${idx}`}
                className={`flex min-h-[2.5rem] min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm font-bold ${binaryOutcomePillClass(hasShares, isNo, tradingClosed)}`}
              >
                <span className="truncate">{displayLabel(label, idx)}</span>
                {shareLabel && (
                  <span className="shrink-0 text-xs font-semibold tabular-nums opacity-90">
                    {shareLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const held = labels
    .map((label, idx) => ({
      label,
      idx,
      bal: balanceForOutcome(positions, idx),
    }))
    .filter((h) => h.bal > BigInt(0));

  if (held.length === 0) {
    return (
      <div className={`${MARKET_CARD_OUTCOMES_BOX} items-center justify-center`}>
        <p className="text-[10px] text-[var(--muted)]">No open positions</p>
      </div>
    );
  }

  return (
    <div className={`${MARKET_CARD_OUTCOMES_BOX} no-scrollbar gap-0.5 overflow-y-auto`}>
      {held.map((h) => {
        const tok = nadMarket ? nadTokenForOutcome(nadMarket, h.label, h.idx) : undefined;
        return (
        <div
          key={`${h.label}-${h.idx}`}
          className={`${MARKET_CARD_MULTI_ROW_CLASS} justify-between transition hover:bg-[var(--surface-hover)]`}
        >
          <span className={`${MARKET_CARD_MULTI_LABEL_CLASS} inline-flex items-center gap-2`}>
            {tok?.imageUri ? (
              <img
                src={tok.imageUri}
                alt=""
                className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
              />
            ) : null}
            {displayLabel(h.label, h.idx)}
          </span>
          <span className="shrink-0 text-[12px] font-medium tabular-nums text-[var(--muted)]">
            {formatShareAmount(h.bal, collateralDecimals)}
          </span>
        </div>
        );
      })}
    </div>
  );
}

type ClaimOverride = {
  payout: bigint;
  claimedAt: number;
};

function SettledMarketSummary({
  invested,
  redeemed,
  tick,
  fmtAmount,
  justClaimed = false,
}: {
  invested: bigint;
  redeemed: bigint;
  tick: string;
  fmtAmount: (v: bigint) => string;
  justClaimed?: boolean;
}) {
  const net = redeemed - invested;
  const hasRedeemed = redeemed > BigInt(0);
  const hasInvested = invested > BigInt(0);

  if (justClaimed && hasRedeemed) {
    return (
      <div className={`${MARKET_CARD_OUTCOMES_BOX} justify-center gap-1 text-center`}>
        <p className="text-sm font-bold text-emerald-400 [html[data-theme=light]_&]:text-emerald-700">
          Successfully claimed
        </p>
        <p className="text-[13px] font-semibold tabular-nums text-[var(--foreground)]">
          {fmtAmount(redeemed)} {tick}
        </p>
        {hasInvested && (
          <p className="text-[11px] text-[var(--muted)]">
            {net >= BigInt(0)
              ? `Net on this market: +${fmtAmount(net)} ${tick}`
              : `Net on this market: −${fmtAmount(-net)} ${tick} (includes losing positions)`}
          </p>
        )}
      </div>
    );
  }

  if (hasRedeemed) {
    const netPositive = net > BigInt(0);
    const netZero = net === BigInt(0);
    return (
      <div className={`${MARKET_CARD_OUTCOMES_BOX} justify-center gap-0.5`}>
        <p className="text-[11px] font-medium text-[var(--muted)]">Redeemed</p>
        <p className="text-[13px] font-semibold tabular-nums text-[var(--foreground)]">
          {fmtAmount(redeemed)} {tick}
        </p>
        {hasInvested && (
          <p
            className={`text-[11px] font-semibold tabular-nums ${
              netPositive
                ? "text-emerald-400 [html[data-theme=light]_&]:text-emerald-700"
                : netZero
                  ? "text-[var(--muted)]"
                  : "text-rose-400 [html[data-theme=light]_&]:text-rose-700"
            }`}
          >
            {netPositive
              ? `Won ${fmtAmount(net)} ${tick}`
              : netZero
                ? "Break even"
                : `Net −${fmtAmount(-net)} ${tick}`}
          </p>
        )}
      </div>
    );
  }

  if (hasInvested) {
    return (
      <div className={`${MARKET_CARD_OUTCOMES_BOX} items-center justify-center`}>
        <p className="text-sm font-bold text-rose-400 [html[data-theme=light]_&]:text-rose-700">You lost</p>
      </div>
    );
  }

  return (
    <div className={`${MARKET_CARD_OUTCOMES_BOX} items-center justify-center gap-0.5 text-center`}>
      <p className="text-sm font-semibold text-[var(--foreground)]">Settled</p>
      <p className="text-[11px] text-[var(--muted)]">No outcome tokens held on-chain anymore.</p>
    </div>
  );
}

function ClaimWinningsButton({
  marketAddress,
  winningOutcomeIndex,
  maxShares,
  shareDecimals,
  redemptionRate,
  collateralTicker,
  onClaimed,
  onDone,
}: {
  marketAddress: `0x${string}`;
  winningOutcomeIndex: number;
  maxShares: bigint;
  shareDecimals: number;
  redemptionRate: bigint;
  collateralTicker: string;
  onClaimed: (result: { payout: bigint }) => void;
  onDone: () => void;
}) {
  const publicClient = usePublicClient({ chainId: DEPLOYMENT_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const { address, chainId } = useAccount();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusIsError, setStatusIsError] = useState(false);
  const maxPayout = useMemo(() => {
    if (redemptionRate <= BigInt(0) || maxShares <= BigInt(0)) return "0";
    const estPayoutWei = (maxShares * redemptionRate) / BigInt(10 ** 18);
    const raw = formatUnits(estPayoutWei, shareDecimals);
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [maxShares, redemptionRate, shareDecimals]);

  const redeem = async () => {
    if (!publicClient || !walletClient || !address) {
      setStatusIsError(true);
      setStatus("Connect wallet.");
      return;
    }
    if (chainId !== DEPLOYMENT_CHAIN_ID) {
      setStatusIsError(true);
      setStatus(wrongNetworkMessage());
      return;
    }
    try {
      setBusy(true);
      setStatusIsError(false);
      setStatus("Preparing…");
      const token = (await publicClient.readContract({
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "outcomeToken",
        args: [BigInt(winningOutcomeIndex)],
      })) as `0x${string}`;
      const allowance = (await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, marketAddress],
      })) as bigint;
      if (allowance < maxShares) {
        setStatus("Approving…");
        const h = await walletClient.writeContract({
          chain: walletClient.chain,
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [marketAddress, maxShares],
          account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      setStatus("Claiming…");
      const tx = await walletClient.writeContract({
        chain: walletClient.chain,
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "redeem",
        args: [winningOutcomeIndex, maxShares],
        account: address,
        gas: BigInt(500_000),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      let payout = BigInt(0);
      try {
        const logs = parseEventLogs({
          abi: MARKET_ABI,
          logs: receipt.logs,
          eventName: "TokensRedeemed",
        });
        for (const log of logs) {
          if (log.args.payout) payout += log.args.payout;
        }
      } catch {
        /* fallback to estimate */
      }
      if (payout <= BigInt(0) && redemptionRate > BigInt(0) && maxShares > BigInt(0)) {
        payout = (maxShares * redemptionRate) / BigInt(10 ** 18);
      }
      setStatusIsError(false);
      setStatus("Successfully claimed!");
      onClaimed({ payout });
      window.setTimeout(() => onDone(), 2800);
    } catch (e) {
      setStatusIsError(true);
      setStatus(friendlyWalletError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()} className="flex h-full flex-col justify-center">
      <p className="mb-1 text-xs font-semibold text-emerald-400">
        {formatShareAmount(maxShares, shareDecimals)}
      </p>
      <p className="mb-1 text-[11px] text-[var(--muted)]">Est. payout: {maxPayout} {collateralTicker}</p>
      {status && (
        <p className={`mb-1.5 text-[11px] ${statusIsError ? "text-rose-300" : "text-emerald-300"}`}>{status}</p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void redeem()}
        className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white shadow-[0_0_16px_rgba(16,185,129,0.3)] transition hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? "Claiming…" : "Claim Winnings"}
      </button>
    </div>
  );
}

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[10px] font-medium tracking-wide text-[var(--foreground)] opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 whitespace-nowrap">
        {label}
      </span>
    </span>
  );
}

export function TradesClient() {
  const router = useRouter();
  const publicClient = usePublicClient({ chainId: DEPLOYMENT_CHAIN_ID });
  const { address, isConnected, chainId } = useAccount();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [claimOverrides, setClaimOverrides] = useState<Record<string, ClaimOverride>>({});
  const [tvlOverrides, setTvlOverrides] = useState<Record<string, string>>({});
  const [tvlRefreshing, setTvlRefreshing] = useState<Record<string, boolean>>({});
  const [nadMarketByAddress, setNadMarketByAddress] = useState<Record<string, NadMarketConfig>>({});

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/markets", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          markets?: Array<{ address?: string; nadMarket?: NadMarketConfig }>;
        };
        const next: Record<string, NadMarketConfig> = {};
        for (const market of json.markets ?? []) {
          const addr = market.address?.toLowerCase();
          if (addr && market.nadMarket) next[addr] = market.nadMarket;
        }
        setNadMarketByAddress(next);
      } catch {
        // Markets list is optional enrichment for Nad.fun card covers.
      }
    })();
  }, []);

  const refreshTvl = async (g: { marketAddress: string; outcomeLabels: string[]; collateralDecimals: number }) => {
    if (!publicClient || tvlRefreshing[g.marketAddress]) return;
    setTvlRefreshing((p) => ({ ...p, [g.marketAddress]: true }));
    try {
      const pools = await Promise.all(
        Array.from({ length: g.outcomeLabels.length }, (_, i) =>
          publicClient.readContract({ address: g.marketAddress as `0x${string}`, abi: MARKET_ABI, functionName: "realPool", args: [BigInt(i)] }) as Promise<bigint>
        )
      );
      const total = pools.reduce((acc, v) => acc + v, BigInt(0));
      const formatted = Number(formatUnits(total, g.collateralDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
      setTvlOverrides((p) => ({ ...p, [g.marketAddress]: formatted }));
    } catch { /* ignore */ } finally {
      setTvlRefreshing((p) => ({ ...p, [g.marketAddress]: false }));
    }
  };

  useEffect(() => {
    const id = setInterval(() => setClock((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!publicClient || !address || !isConnected) {
        setRows([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/trades/positions?wallet=${address}`, { cache: "no-store" });
        const raw = await res.text();
        let json: {
          rows?: Array<{
            marketAddress: `0x${string}`;
            collateralAddress: `0x${string}`;
            marketTitle: string;
            marketKind: "Event" | "Price" | "Nad";
            marketState: number;
            stakeEndUnix: number;
            winningOutcomeIndex: number | null;
            redemptionRate: string;
            outcomeIndex: number;
            outcomeLabel: string;
            outcomeLabels: string[];
            balance: string;
            collateralDecimals: number;
            chancePct: number;
            outcomeChancePcts?: number[];
            poolTvlDisplay: string;
            stakeEndsLabel: string;
            imageUrl: string;
            nadMarket?: NadMarketConfig | null;
            indexedCollateralIn?: string;
            indexedCollateralOut?: string;
            settlementDisplay?: "claimed" | "settled_no_shares";
          }>;
          error?: string;
          unavailable?: boolean;
        };
        try {
          json = raw ? (JSON.parse(raw) as typeof json) : {};
        } catch {
          throw new Error("Could not load trades.");
        }
        if (!res.ok) {
          throw new Error(json.error || "Could not load trades.");
        }
        const parsed: PositionRow[] = (json.rows ?? []).map((r) => ({
          marketAddress: r.marketAddress,
          collateralAddress: r.collateralAddress,
          marketTitle: r.marketTitle,
          marketKind: r.marketKind,
          marketState: r.marketState,
          stakeEndUnix: r.stakeEndUnix,
          winningOutcomeIndex: r.winningOutcomeIndex,
          redemptionRate: BigInt(r.redemptionRate),
          outcomeIndex: r.outcomeIndex,
          outcomeLabel: r.outcomeLabel,
          outcomeLabels: r.outcomeLabels,
          balance: BigInt(r.balance),
          collateralDecimals: r.collateralDecimals,
          chancePct: clampPct(r.chancePct),
          outcomeChancePcts: (r.outcomeChancePcts ?? []).map((p) => clampPct(p)),
          poolTvlDisplay: r.poolTvlDisplay,
          stakeEndsLabel: r.stakeEndsLabel || fmtTs(r.stakeEndUnix),
          imageUrl: r.imageUrl,
          nadMarket: r.nadMarket ?? null,
          indexedCollateralIn: BigInt((r as { indexedCollateralIn?: string }).indexedCollateralIn ?? "0"),
          indexedCollateralOut: BigInt((r as { indexedCollateralOut?: string }).indexedCollateralOut ?? "0"),
          settlementDisplay: (r as { settlementDisplay?: "claimed" | "settled_no_shares" }).settlementDisplay,
        }));
        setRows(parsed);
        setClaimOverrides((prev) => {
          const next = { ...prev };
          for (const row of parsed) {
            const key = row.marketAddress.toLowerCase();
            const override = next[key];
            if (!override) continue;
            if (row.indexedCollateralOut >= override.payout) {
              delete next[key];
            }
          }
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load trades.");
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, [publicClient, address, isConnected, refreshKey]);

  const sortedRows = useMemo(() => {
    void clock;
    return [...rows].sort((a, b) => b.stakeEndUnix - a.stakeEndUnix);
  }, [rows, clock]);

  const groups = useMemo(() => groupRows(sortedRows), [sortedRows]);

  return (
    <AppLayout
      showSearch={false}
      pageBackgroundClassName="aftr-page-bg-gradient"
    >
      <section className="mx-4 pt-8 md:mx-6">
        <div className="mb-2 flex items-center gap-2">
          <PlusMinus size={22} weight="bold" className="text-[var(--accent)]" />
          <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)] md:text-2xl">Trades</h1>
        </div>

        {!isConnected && (
          <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            Connect your wallet to view your positions.
          </p>
        )}
        {isConnected && chainId !== DEPLOYMENT_CHAIN_ID && (
          <p className="max-w-xl text-sm leading-relaxed text-red-400">
            {wrongNetworkMessage()} to load trades.
          </p>
        )}
        {isConnected && chainId === DEPLOYMENT_CHAIN_ID && isLoading && (
          <div
            className="flex min-h-[45vh] items-center justify-center"
            aria-busy="true"
            aria-label="Loading positions"
          >
            <CircleNotch size={36} weight="bold" className="animate-spin text-[var(--accent)]" />
          </div>
        )}
        {error && <p className="max-w-xl text-sm leading-relaxed text-red-400">{error}</p>}
        {!isLoading && !error && isConnected && chainId === DEPLOYMENT_CHAIN_ID && groups.length === 0 && (
          <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            No markets with positions or indexed activity for this wallet.
          </p>
        )}

        {!isLoading && groups.length > 0 && (
          <div className={MARKET_CARD_TRADES_GRID_CLASS}>
            {groups.map((g) => {
              const winIdx = g.winningOutcomeIndex;
              const winBal =
                g.marketState === 2 && winIdx !== null ? balanceForOutcome(g.positions, winIdx) : BigInt(0);
              const claimOverride = claimOverrides[g.marketAddress.toLowerCase()];
              const effectiveRedeemed =
                claimOverride && claimOverride.payout > g.indexedCollateralOut
                  ? claimOverride.payout
                  : g.indexedCollateralOut;
              const canClaim =
                winIdx !== null && winBal > BigInt(0) && !claimOverride && g.marketState === 2;
              const justClaimed = Boolean(claimOverride);
              const tick = collateralTickerFromDeployment(g.collateralAddress);
              const fmtIndexed = (v: bigint) =>
                Number(formatUnits(v, g.collateralDecimals)).toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                });
              const tradingClosed =
                g.marketState !== 0 || Math.floor(Date.now() / 1000) >= g.stakeEndUnix;
              const nadMarket =
                g.nadMarket ?? nadMarketByAddress[g.marketAddress.toLowerCase()] ?? null;

              return (
                <article
                  key={g.marketAddress}
                  className={`${MARKET_CARD_TRADES_SHELL_CLASS} transition duration-200 hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-[0_16px_40px_rgb(139_92_246_/_0.28)] [html[data-theme=light]_&]:hover:shadow-[0_16px_40px_rgb(124_77_255_/_0.14)]`}
                >
                  {nadMarket ? (
                    <NadMarketCardCover nadMarket={nadMarket} />
                  ) : (
                  <div className={`${MARKET_COVER_ASPECT_CLASS} w-full shrink-0 overflow-hidden bg-[var(--surface)]`}>
                    {g.imageUrl ? (
                      <img
                        src={g.imageUrl}
                        alt={g.marketTitle}
                        className="h-full w-full object-cover object-center"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--muted)]">
                        No cover image
                      </div>
                    )}
                  </div>
                  )}

                  <div className={MARKET_CARD_TRADES_BODY_CLASS}>
                    <p
                      className={`${MARKET_CARD_TRADES_TITLE_CLASS} cursor-pointer underline-offset-2 hover:underline`}
                      onClick={() => router.push(`/market/${g.marketAddress}`)}
                    >
                      {g.marketTitle}
                    </p>
                    <p className={MARKET_CARD_TRADES_META_CLASS}>
                      {g.marketKind} · {stateLabel(g.marketState, g.stakeEndUnix)}
                    </p>

                    {g.marketState === 2 ? (
                      canClaim ? (
                        <div
                          className={`${MARKET_CARD_OUTCOMES_BOX} justify-center`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ClaimWinningsButton
                              marketAddress={g.marketAddress}
                              winningOutcomeIndex={winIdx!}
                              maxShares={winBal}
                              shareDecimals={g.collateralDecimals}
                              redemptionRate={g.redemptionRate}
                              collateralTicker={tick}
                              onClaimed={({ payout }) => {
                                setClaimOverrides((prev) => ({
                                  ...prev,
                                  [g.marketAddress.toLowerCase()]: {
                                    payout,
                                    claimedAt: Date.now(),
                                  },
                                }));
                              }}
                              onDone={() => setRefreshKey((k) => k + 1)}
                            />
                        </div>
                      ) : (
                        <SettledMarketSummary
                            invested={g.indexedCollateralIn}
                            redeemed={effectiveRedeemed}
                            tick={tick}
                            fmtAmount={fmtIndexed}
                            justClaimed={justClaimed}
                          />
                      )
                    ) : (
                      <OpenPositionHoldings
                          labels={g.outcomeLabels}
                          positions={g.positions}
                          collateralDecimals={g.collateralDecimals}
                          outcomeChancePcts={g.outcomeChancePcts}
                          tradingClosed={tradingClosed}
                          nadMarket={nadMarket}
                        />
                    )}
                  </div>

                  <div className={MARKET_CARD_TRADES_FOOTER_SLOT_CLASS}>
                  <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] text-[var(--muted)]">
                    <Tip label="Total Value Locked">
                      <div className="inline-flex items-center gap-1.5 font-semibold text-[var(--foreground)]">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-[#4f7cff] to-[#6dff8e]" />
                        {`$${tvlOverrides[g.marketAddress] ?? g.poolTvlDisplay}`}
                      </div>
                    </Tip>
                    <div className="flex items-center gap-2">
                      <Tip label="Refresh TVL">
                        <button type="button" onClick={(e) => { e.stopPropagation(); void refreshTvl(g); }}
                          className="inline-flex items-center transition hover:text-[var(--foreground)]">
                          <ArrowsClockwise size={12} className={tvlRefreshing[g.marketAddress] ? "animate-spin" : ""} />
                        </button>
                      </Tip>
                      <Tip label="Staking ends">
                        <span>{g.stakeEndsLabel}</span>
                      </Tip>
                      <BookmarkSimple size={12} />
                    </div>
                  </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </AppLayout>
  );
}

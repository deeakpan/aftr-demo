"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise, BookmarkSimple, Copy, PlusMinus, X } from "@phosphor-icons/react";
import { formatUnits, parseAbi, zeroAddress } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import deployment from "@/deployments/baseSepolia-84532.json";
import { collateralTickerFromDeployment } from "@/lib/deployment-collateral";

const ROUTER_ADDRESS = deployment.contracts.AFTRMarketDebtRouter as `0x${string}`;
const DRP_ADDRESS = (deployment as unknown as { contracts: Record<string, string> }).contracts
  .DRP as `0x${string}`;
const DEPLOYMENT_CHAIN_ID = deployment.chainId;
const USDEAD_ADDRESS = (
  (deployment as unknown as { contracts: Record<string, string> }).contracts.USDeAD ?? ""
)?.toLowerCase();

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
]);
const ROUTER_ABI = parseAbi([
  "function redeemForSelf(address market, uint8 outcomeIndex, uint256 shareAmount)",
  "function redeemAndRepayForSelf(address market, uint8 outcomeIndex, uint256 shareAmount, address vaultCollateralToken, uint256 debtToBurn)",
]);
const DRP_ABI = parseAbi([
  "function getUserVaultDetails(address _user, address _token) view returns (uint256 collateral,uint256 debt,uint256 pendingWithdrawalAmount,uint256 unlockTimestamp,bool isClosing,bool isLiquidated)",
  "function trustedManagers(address manager) view returns (bool)",
  "function isVaultManager(address owner, address manager) view returns (bool)",
  "function approveManager(address manager, bool active)",
]);

type VaultCollateralOption = {
  label: string;
  address: `0x${string}`;
};
const VAULT_COLLATERAL_OPTIONS =
  (deployment as unknown as { external?: { vaultCollateralOptions?: VaultCollateralOption[] } })
    .external?.vaultCollateralOptions ?? [
    {
      label: "WETH",
      address: "0x4200000000000000000000000000000000000006" as `0x${string}`,
    },
  ];

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

type PositionRow = {
  marketAddress: `0x${string}`;
  collateralAddress: `0x${string}`;
  marketTitle: string;
  marketKind: "Event" | "Price";
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
  poolTvlDisplay: string;
  stakeEndsLabel: string;
  imageUrl: string;
  indexedCollateralIn: bigint;
  indexedCollateralOut: bigint;
  /** Synthetic row after claim — no ERC20 balance left */
  settlementDisplay?: "claimed" | "settled_no_shares";
};


type MarketPositionGroup = {
  marketAddress: `0x${string}`;
  collateralAddress: `0x${string}`;
  marketTitle: string;
  marketKind: "Event" | "Price";
  marketState: number;
  stakeEndUnix: number;
  winningOutcomeIndex: number | null;
  redemptionRate: bigint;
  outcomeLabels: string[];
  chancePct: number;
  poolTvlDisplay: string;
  stakeEndsLabel: string;
  imageUrl: string;
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
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} shares`;
}

function fmtTs(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

function stateLabel(state: number, stakeEndUnix: number) {
  if (state === 2) return "Settled";
  if (state === 1) return "Resolving (UMA)";
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
    return "Not enough ETH on Base Sepolia to pay gas.";
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
      poolTvlDisplay: head.poolTvlDisplay,
      stakeEndsLabel: head.stakeEndsLabel,
      imageUrl: head.imageUrl,
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

function SettledMarketSummary({
  invested,
  redeemed,
  tick,
  fmtAmount,
}: {
  invested: bigint;
  redeemed: bigint;
  tick: string;
  fmtAmount: (v: bigint) => string;
}) {
  const net = redeemed - invested;
  const hasRedeemed = redeemed > BigInt(0);
  const hasInvested = invested > BigInt(0);

  if (hasRedeemed) {
    const netPositive = net > BigInt(0);
    const netZero = net === BigInt(0);
    return (
      <div className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5">
        <p className="text-sm font-bold text-emerald-400 [html[data-theme=light]_&]:text-emerald-700">Redeemed</p>
        <p className="mt-0.5 text-[11px] font-semibold text-[var(--foreground)]">
          {fmtAmount(redeemed)} {tick}
        </p>
        {hasInvested && (
          <p
            className={`mt-0.5 text-[11px] font-semibold ${
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
      <div className="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/5 px-2 py-1.5">
        <p className="text-sm font-bold text-rose-400 [html[data-theme=light]_&]:text-rose-700">You lost</p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
      <p className="text-sm font-semibold text-[var(--foreground)]">Settled</p>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">No outcome tokens held on-chain anymore.</p>
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
  collateralAddress,
  indexedCollateralIn,
  onDone,
}: {
  marketAddress: `0x${string}`;
  winningOutcomeIndex: number;
  maxShares: bigint;
  shareDecimals: number;
  redemptionRate: bigint;
  collateralTicker: string;
  collateralAddress: `0x${string}`;
  indexedCollateralIn: bigint;
  onDone: () => void;
}) {
  const publicClient = usePublicClient({ chainId: DEPLOYMENT_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const { address, chainId } = useAccount();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [repayMode, setRepayMode] = useState(false);
  const [selectedVaultCollateral, setSelectedVaultCollateral] = useState<`0x${string}`>(
    VAULT_COLLATERAL_OPTIONS[0]!.address,
  );
  const [debtWei, setDebtWei] = useState<bigint>(BigInt(0));
  const [debtLoading, setDebtLoading] = useState(false);
  const [debtError, setDebtError] = useState("");
  const [copiedVaultAddress, setCopiedVaultAddress] = useState(false);
  const [shareApprovalReady, setShareApprovalReady] = useState(false);
  const [drpApprovalReady, setDrpApprovalReady] = useState(false);
  const [routerTrustedByDrp, setRouterTrustedByDrp] = useState<boolean | null>(null);
  const [vaultManagerApproved, setVaultManagerApproved] = useState<boolean | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const isUsdeadMarket = Boolean(
    USDEAD_ADDRESS && collateralAddress.toLowerCase() === USDEAD_ADDRESS,
  );
  const estPayoutWei = useMemo(
    () => (redemptionRate <= BigInt(0) || maxShares <= BigInt(0) ? BigInt(0) : (maxShares * redemptionRate) / BigInt(10 ** 18)),
    [maxShares, redemptionRate],
  );
  const maxPayout = useMemo(() => {
    if (estPayoutWei <= BigInt(0)) return "0";
    const raw = formatUnits(estPayoutWei, shareDecimals);
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [estPayoutWei, shareDecimals]);

  useEffect(() => {
    if (!modalOpen || !isUsdeadMarket || !publicClient || !address) return;
    let cancelled = false;
    void (async () => {
      try {
        setDebtLoading(true);
        setDebtError("");
        const details = (await publicClient.readContract({
          address: DRP_ADDRESS,
          abi: DRP_ABI,
          functionName: "getUserVaultDetails",
          args: [address, selectedVaultCollateral],
        })) as [bigint, bigint, bigint, bigint, boolean, boolean];
        if (!cancelled) setDebtWei(details[1]);
      } catch (e) {
        if (!cancelled) {
          setDebtWei(BigInt(0));
          setDebtError(e instanceof Error ? e.message : "Could not fetch debt.");
        }
      } finally {
        if (!cancelled) setDebtLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen, repayMode, isUsdeadMarket, publicClient, address, selectedVaultCollateral]);

  useEffect(() => {
    if (!modalOpen || !isUsdeadMarket || !publicClient || !address) return;
    let cancelled = false;
    void (async () => {
      try {
        const [trusted, approved] = (await Promise.all([
          publicClient.readContract({
            address: DRP_ADDRESS,
            abi: DRP_ABI,
            functionName: "trustedManagers",
            args: [ROUTER_ADDRESS],
          }),
          publicClient.readContract({
            address: DRP_ADDRESS,
            abi: DRP_ABI,
            functionName: "isVaultManager",
            args: [address, ROUTER_ADDRESS],
          }),
        ])) as [boolean, boolean];
        if (!cancelled) {
          setRouterTrustedByDrp(trusted);
          setVaultManagerApproved(approved);
        }
      } catch {
        if (!cancelled) {
          setRouterTrustedByDrp(null);
          setVaultManagerApproved(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen, isUsdeadMarket, publicClient, address]);

  // DRP charges 1% fee on burnAmount; with payout budget P, max burn ≈ P * 10000 / 10100.
  const maxDebtBurnFromWinningsWei = useMemo(
    () => (estPayoutWei * BigInt(10_000)) / BigInt(10_100),
    [estPayoutWei],
  );
  const debtToBurnWei = useMemo(
    () => (debtWei < maxDebtBurnFromWinningsWei ? debtWei : maxDebtBurnFromWinningsWei),
    [debtWei, maxDebtBurnFromWinningsWei],
  );
  const debtLeftAfterWei = useMemo(
    () => (debtWei > debtToBurnWei ? debtWei - debtToBurnWei : BigInt(0)),
    [debtWei, debtToBurnWei],
  );
  const fmtCollateral = (v: bigint) =>
    Number(formatUnits(v, shareDecimals)).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const collateralInLabel = useMemo(() => fmtCollateral(indexedCollateralIn), [indexedCollateralIn]);

  useEffect(() => {
    if (!modalOpen || !isUsdeadMarket || !publicClient || !address) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = (await publicClient.readContract({
          address: marketAddress,
          abi: MARKET_ABI,
          functionName: "outcomeToken",
          args: [BigInt(winningOutcomeIndex)],
        })) as `0x${string}`;
        const [shareAllowance, drpAllowance] = (await Promise.all([
          publicClient.readContract({
            address: token,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, ROUTER_ADDRESS],
          }),
          publicClient.readContract({
            address: collateralAddress,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, DRP_ADDRESS],
          }),
        ])) as [bigint, bigint];
        const requiredWithFee = debtToBurnWei + (debtToBurnWei * BigInt(100)) / BigInt(10_000);
        if (!cancelled) {
          setShareApprovalReady(shareAllowance >= maxShares);
          setDrpApprovalReady(drpAllowance >= requiredWithFee);
        }
      } catch {
        if (!cancelled) {
          setShareApprovalReady(false);
          setDrpApprovalReady(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    modalOpen,
    isUsdeadMarket,
    publicClient,
    address,
    marketAddress,
    winningOutcomeIndex,
    collateralAddress,
    maxShares,
    debtToBurnWei,
  ]);

  const enableVaultManager = async () => {
    if (!publicClient || !walletClient || !address) {
      setStatus("Connect wallet.");
      setStatusIsError(true);
      return;
    }
    if (chainId !== DEPLOYMENT_CHAIN_ID) {
      setStatus("Switch to Base Sepolia.");
      setStatusIsError(true);
      return;
    }
    try {
      setBusy(true);
      setStatusIsError(false);
      setStatus("Approve router as vault manager…");
      const tx = await walletClient.writeContract({
        chain: walletClient.chain,
        address: DRP_ADDRESS,
        abi: DRP_ABI,
        functionName: "approveManager",
        args: [ROUTER_ADDRESS, true],
        account: address,
        gas: BigInt(250_000),
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      const approved = (await publicClient.readContract({
        address: DRP_ADDRESS,
        abi: DRP_ABI,
        functionName: "isVaultManager",
        args: [address, ROUTER_ADDRESS],
      })) as boolean;
      setVaultManagerApproved(approved);
      setStatus(approved ? "Router can manage your vault for repay." : "Could not confirm approval — try refreshing.");
      setStatusIsError(!approved);
    } catch (e) {
      setStatusIsError(true);
      setStatus(friendlyWalletError(e));
    } finally {
      setBusy(false);
    }
  };

  const redeem = async (withRepay: boolean) => {
    if (!publicClient || !walletClient || !address) { setStatusIsError(true); setStatus("Connect wallet."); return; }
    if (chainId !== DEPLOYMENT_CHAIN_ID) { setStatusIsError(true); setStatus(`Switch to Base Sepolia.`); return; }
    try {
      setBusy(true);
      setStatusIsError(false);
      setStatus("Preparing…");
      if (withRepay) {
        const approved = (await publicClient.readContract({
          address: DRP_ADDRESS,
          abi: DRP_ABI,
          functionName: "isVaultManager",
          args: [address, ROUTER_ADDRESS],
        })) as boolean;
        if (!approved) {
          setStatusIsError(true);
          setStatus(
            "Claim + repay needs the AFTR router allowed as your DRP vault manager. Tap “Enable vault manager” below, then try again.",
          );
          setBusy(false);
          return;
        }
      }
      const token = (await publicClient.readContract({
        address: marketAddress, abi: MARKET_ABI, functionName: "outcomeToken",
        args: [BigInt(winningOutcomeIndex)],
      })) as `0x${string}`;
      const allowance = (await publicClient.readContract({
        address: token, abi: ERC20_ABI, functionName: "allowance",
        args: [address, ROUTER_ADDRESS],
      })) as bigint;
      if (allowance < maxShares) {
        setStatus("Approving…");
        const h = await walletClient.writeContract({
          chain: walletClient.chain, address: token, abi: ERC20_ABI,
          functionName: "approve", args: [ROUTER_ADDRESS, maxShares], account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      let liveDebtToBurn = debtToBurnWei;
      if (withRepay) {
        // Re-read debt at submit time so we don't use stale modal state.
        const details = (await publicClient.readContract({
          address: DRP_ADDRESS,
          abi: DRP_ABI,
          functionName: "getUserVaultDetails",
          args: [address, selectedVaultCollateral],
        })) as [bigint, bigint, bigint, bigint, boolean, boolean];
        const liveDebt = details[1];
        const maxBurnNow = (estPayoutWei * BigInt(10_000)) / BigInt(10_100);
        liveDebtToBurn = liveDebt < maxBurnNow ? liveDebt : maxBurnNow;

        // DRP pulls USDeAD from user directly for burn + 1% fee.
        const requiredWithFee = liveDebtToBurn + (liveDebtToBurn * BigInt(100)) / BigInt(10_000);
        const drpAllowance = (await publicClient.readContract({
          address: collateralAddress,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, DRP_ADDRESS],
        })) as bigint;
        if (drpAllowance < requiredWithFee) {
          setStatus("Approving DRP for repay…");
          const approveDrp = await walletClient.writeContract({
            chain: walletClient.chain,
            address: collateralAddress,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [DRP_ADDRESS, requiredWithFee],
            account: address,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveDrp });
        }
      }

      setStatus(withRepay ? "Claiming + repaying…" : "Claiming…");
      const tx = await walletClient.writeContract({
        chain: walletClient.chain,
        address: ROUTER_ADDRESS,
        abi: ROUTER_ABI,
        functionName: withRepay ? "redeemAndRepayForSelf" : "redeemForSelf",
        args: withRepay
          ? [marketAddress, winningOutcomeIndex, maxShares, selectedVaultCollateral, liveDebtToBurn]
          : [marketAddress, winningOutcomeIndex, maxShares],
        account: address,
        gas: withRepay ? BigInt(900_000) : BigInt(500_000),
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("Claimed!");
      setModalOpen(false);
      onDone();
    } catch (e) {
      setStatusIsError(true);
      setStatus(friendlyWalletError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
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
        onClick={() => {
          if (isUsdeadMarket) {
            setRepayMode(false);
            setStatus("");
            setStatusIsError(false);
            setModalOpen(true);
            return;
          }
          void redeem(false);
        }}
        className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white shadow-[0_0_16px_rgba(16,185,129,0.3)] transition hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? "Claiming…" : isUsdeadMarket ? "Claim / Repay" : "Claim Winnings"}
      </button>
      {isUsdeadMarket && modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay-scrim)] p-3 backdrop-blur-[2px] md:items-center"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-left shadow-[var(--elevated-card-shadow)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="absolute right-2 top-2 rounded-full p-1 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
              aria-label="Close"
            >
              <X size={16} weight="bold" />
            </button>
            <p className="text-sm font-semibold text-[var(--foreground)]">Claim Winnings (USDeAD)</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Choose to claim only, or claim and repay DRP debt in one transaction.
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Collateral put in (indexed):{" "}
              <span className="font-semibold text-[var(--foreground)]">
                {collateralInLabel} {collateralTicker}
              </span>
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRepayMode(false);
                }}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                  !repayMode ? "border-emerald-500 bg-emerald-600 text-white" : "border-[var(--border)] text-[var(--muted)] bg-[var(--surface)]"
                }`}
              >
                Claim only
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRepayMode(true);
                }}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                  repayMode ? "border-indigo-500 bg-indigo-600 text-white" : "border-[var(--border)] text-[var(--muted)] bg-[var(--surface)]"
                }`}
              >
                Claim + Repay
              </button>
            </div>

            <div className="mt-3 space-y-2 text-xs">
              <label className="block text-[var(--muted)]">Vault collateral token</label>
              <div className="group flex items-center justify-between border-b border-[var(--border)] pb-1.5 text-[var(--foreground)]">
                <button
                  type="button"
                  onClick={() => setSelectedVaultCollateral(VAULT_COLLATERAL_OPTIONS[0]!.address)}
                  className="text-left"
                  title="Vault collateral token"
                >
                  {VAULT_COLLATERAL_OPTIONS[0]!.label}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(selectedVaultCollateral);
                    setCopiedVaultAddress(true);
                    setTimeout(() => setCopiedVaultAddress(false), 1200);
                  }}
                  className="opacity-0 transition group-hover:opacity-100 hover:text-emerald-500"
                  title="Copy vault collateral address"
                >
                  <Copy size={14} weight="bold" />
                </button>
              </div>
              {copiedVaultAddress && (
                <p className="text-[11px] text-emerald-600 [html[data-theme=dark]_&]:text-emerald-300">Vault token address copied</p>
              )}
              {debtLoading ? (
                <p className="text-[var(--muted)]">Loading debt…</p>
              ) : (
                <>
                  <p className="text-[var(--muted)]">Current debt: <span className="font-semibold text-[var(--foreground)]">{fmtCollateral(debtWei)} USDeAD</span></p>
                  <p className="text-[var(--muted)]">Est. repayable from winnings: <span className="font-semibold text-[var(--foreground)]">{fmtCollateral(debtToBurnWei)} USDeAD</span></p>
                  <p className="text-[var(--muted)]">Est. debt left: <span className="font-semibold text-[var(--foreground)]">{fmtCollateral(debtLeftAfterWei)} USDeAD</span></p>
                  <p className="text-[11px] text-[var(--muted)] opacity-90">Repay uses DRP 1% fee; estimates account for that.</p>
                </>
              )}
              {debtError && <p className="text-rose-400">{debtError}</p>}
            </div>

            <p className="mt-3 text-[11px] text-[var(--muted)]">
              Aftrmarkets uses the{" "}
              <span className="font-semibold text-[var(--foreground)]">AFTR router</span> with{" "}
              <a
                href="https://dead.box"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-emerald-600 underline underline-offset-2 [html[data-theme=dark]_&]:text-emerald-300"
              >
                DRP
              </a>
              . The protocol trusts this router globally;{" "}
              <span className="text-[var(--muted)]">
                each wallet still approves it once per account as{" "}
                <span className="font-semibold text-[var(--foreground)]">your</span> vault manager to use Claim + Repay.
              </span>
            </p>
            {repayMode && routerTrustedByDrp === false && (
              <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-1.5 text-[11px] text-amber-900 [html[data-theme=dark]_&]:bg-amber-950/40 [html[data-theme=dark]_&]:text-amber-200">
                This deployment’s router is not marked trusted in DRP — Claim + repay may revert. Claim-only should still work.
              </p>
            )}
            {repayMode && vaultManagerApproved === false && routerTrustedByDrp !== false && (
              <div className="mt-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2 [html[data-theme=dark]_&]:bg-indigo-950/30">
                <p className="text-[11px] text-indigo-950 [html[data-theme=dark]_&]:text-indigo-100">
                  One-time setup: allow the AFTR router to act as your vault manager in DRP so it can repay from your claim.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void enableVaultManager()}
                  className="mt-2 w-full rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {busy ? "Waiting for wallet…" : "Enable vault manager"}
                </button>
              </div>
            )}
            {repayMode && vaultManagerApproved === true && (
              <p className="mt-2 text-[11px] text-emerald-400/90">✓ This wallet has approved the router as its DRP vault manager.</p>
            )}
            <div className="mt-3 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--muted)]">
              {repayMode ? (
                <>
                  This action may require multiple confirmations:
                  <div className="mt-1 space-y-0.5 text-[var(--muted)]">
                    <p>
                      0) {vaultManagerApproved ? "✓ " : ""}Allow router as your DRP vault manager (Claim + Repay only)
                    </p>
                    <p>1) {shareApprovalReady ? "✓ " : ""}Approve winning shares to router</p>
                    <p>2) {drpApprovalReady ? "✓ " : ""}Approve DRP USDeAD spend</p>
                    <p>3) Execute claim + repay</p>
                  </div>
                </>
              ) : (
                <>
                  This action may require up to two confirmations:
                  <div className="mt-1 space-y-0.5 text-[var(--muted)]">
                    <p>1) Approve winning shares to router</p>
                    <p>2) Execute claim</p>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              disabled={
                busy ||
                (repayMode && debtLoading) ||
                (repayMode && vaultManagerApproved === false && routerTrustedByDrp !== false)
              }
              onClick={() => void redeem(repayMode)}
              className="mt-3 w-full rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Processing…" : repayMode ? "Confirm Claim + Repay" : "Confirm Claim"}
            </button>
          </div>
        </div>
      )}
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
  const [tvlOverrides, setTvlOverrides] = useState<Record<string, string>>({});
  const [tvlRefreshing, setTvlRefreshing] = useState<Record<string, boolean>>({});

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
        const json = (await res.json()) as {
          rows?: Array<{
            marketAddress: `0x${string}`;
            collateralAddress: `0x${string}`;
            marketTitle: string;
            marketKind: "Event" | "Price";
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
            poolTvlDisplay: string;
            stakeEndsLabel: string;
            imageUrl: string;
            indexedCollateralIn?: string;
            indexedCollateralOut?: string;
            settlementDisplay?: "claimed" | "settled_no_shares";
          }>;
          error?: string;
        };
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
          poolTvlDisplay: r.poolTvlDisplay,
          stakeEndsLabel: r.stakeEndsLabel || fmtTs(r.stakeEndUnix),
          imageUrl: r.imageUrl,
          indexedCollateralIn: BigInt((r as { indexedCollateralIn?: string }).indexedCollateralIn ?? "0"),
          indexedCollateralOut: BigInt((r as { indexedCollateralOut?: string }).indexedCollateralOut ?? "0"),
          settlementDisplay: (r as { settlementDisplay?: "claimed" | "settled_no_shares" }).settlementDisplay,
        }));
        setRows(parsed);
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
            Switch to Base Sepolia ({DEPLOYMENT_CHAIN_ID}) to load trades.
          </p>
        )}
        {isConnected && chainId === DEPLOYMENT_CHAIN_ID && isLoading && (
          <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)]">Loading your positions...</p>
        )}
        {error && <p className="max-w-xl text-sm leading-relaxed text-red-400">{error}</p>}
        {!isLoading && !error && isConnected && chainId === DEPLOYMENT_CHAIN_ID && groups.length === 0 && (
          <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            No markets with positions or indexed activity for this wallet.
          </p>
        )}

        {groups.length > 0 && (
          <div className="mt-5 grid max-w-[760px] gap-3 md:grid-cols-2">
            {groups.map((g) => {
              const chance = Number.isFinite(g.chancePct) ? g.chancePct : 50;
              const nOutcomes = g.outcomeLabels.length;
              const extraPositions = g.positions.filter((p) => p.outcomeIndex >= 2);

              const winIdx = g.winningOutcomeIndex;
              const winBal =
                g.marketState === 2 && winIdx !== null ? balanceForOutcome(g.positions, winIdx) : BigInt(0);
              const tick = collateralTickerFromDeployment(g.collateralAddress);
              const fmtIndexed = (v: bigint) =>
                Number(formatUnits(v, g.collateralDecimals)).toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                });

              return (
                <article
                  key={g.marketAddress}
                  className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-0 shadow-[var(--elevated-card-shadow)] transition hover:border-[var(--accent)]/35"
                >
                  <div className="aspect-[16/7] w-full overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]">
                    {g.imageUrl ? (
                      <img src={g.imageUrl} alt={g.marketTitle} className="h-full w-full object-cover object-center" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--muted)]">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="p-2.5">
                    <p className="line-clamp-2 cursor-pointer text-base leading-snug font-semibold text-[var(--foreground)] underline-offset-2 hover:underline" onClick={() => router.push(`/market/${g.marketAddress}`)}>{g.marketTitle}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {g.marketKind} · {stateLabel(g.marketState, g.stakeEndUnix)}
                    </p>

                    <div className="mt-2 flex items-center justify-between text-xs font-semibold">
                      <span className="text-emerald-400 [html[data-theme=light]_&]:text-emerald-700">{chance.toFixed(0)}%</span>
                      <span className="text-rose-400 [html[data-theme=light]_&]:text-rose-700">{(100 - chance).toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full border border-[var(--border)] bg-[var(--surface)] p-[2px]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500/70 to-rose-500/70"
                        style={{ width: `${chance}%` }}
                      />
                    </div>

                    {g.marketState === 2 ? (
                      winIdx !== null && winBal > BigInt(0) ? (
                        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                          <ClaimWinningsButton
                            marketAddress={g.marketAddress}
                            winningOutcomeIndex={winIdx}
                            maxShares={winBal}
                            shareDecimals={g.collateralDecimals}
                            redemptionRate={g.redemptionRate}
                            collateralTicker={tick}
                            collateralAddress={g.collateralAddress}
                            indexedCollateralIn={g.indexedCollateralIn}
                            onDone={() => setRefreshKey((k) => k + 1)}
                          />
                          {g.indexedCollateralOut > BigInt(0) && (
                            <SettledMarketSummary
                              invested={g.indexedCollateralIn}
                              redeemed={g.indexedCollateralOut}
                              tick={tick}
                              fmtAmount={fmtIndexed}
                            />
                          )}
                        </div>
                      ) : (
                        <SettledMarketSummary
                          invested={g.indexedCollateralIn}
                          redeemed={g.indexedCollateralOut}
                          tick={tick}
                          fmtAmount={fmtIndexed}
                        />
                      )
                    ) : (
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          {g.outcomeLabels.slice(0, 2).map((label, idx) => {
                            const bal = balanceForOutcome(g.positions, idx);
                            const has = bal > BigInt(0);
                            return (
                              <div
                                key={`${g.marketAddress}-${label}`}
                                className={`rounded-md border px-1.5 py-1 text-center ${
                                  idx === 0
                                    ? "border-emerald-500/40 bg-emerald-500/10 [html[data-theme=light]_&]:bg-emerald-50"
                                    : "border-rose-500/40 bg-rose-500/10 [html[data-theme=light]_&]:bg-rose-50"
                                }`}
                              >
                                <p className={`text-[11px] font-semibold uppercase tracking-wide ${idx === 0 ? "text-emerald-200 [html[data-theme=light]_&]:text-emerald-800" : "text-rose-200 [html[data-theme=light]_&]:text-rose-800"}`}>
                                  {label}
                                </p>
                                <p className={`mt-0.5 text-[10px] font-medium leading-tight ${has ? "text-[var(--foreground)]" : "text-[var(--muted)] opacity-80"}`}>
                                  {has ? formatShareAmount(bal, g.collateralDecimals) : "—"}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                        {nOutcomes > 2 && extraPositions.length > 0 && (
                          <div className="mt-2 space-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Other outcomes</p>
                            {extraPositions.map((p) => (
                              <p key={p.outcomeIndex} className="text-xs text-[var(--foreground)]">
                                <span className="text-[var(--muted)]">{g.outcomeLabels[p.outcomeIndex] ?? `Outcome ${p.outcomeIndex + 1}`}:</span>{" "}
                                {formatShareAmount(p.balance, g.collateralDecimals)}
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] text-[var(--muted)]">
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
                </article>
              );
            })}
          </div>
        )}
      </section>
    </AppLayout>
  );
}

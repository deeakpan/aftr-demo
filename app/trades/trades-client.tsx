"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise, BookmarkSimple, Copy, PlusMinus, X } from "@phosphor-icons/react";
import { formatUnits, parseAbi, zeroAddress } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import deployment from "@/deployments/baseSepolia-84532.json";

const ROUTER_ADDRESS = deployment.contracts.AFTRMarketDebtRouter as `0x${string}`;
const DRP_ADDRESS = (deployment as unknown as { contracts: Record<string, string> }).contracts
  .DRP as `0x${string}`;
const DEPLOYMENT_CHAIN_ID = deployment.chainId;
const USDEAD_ADDRESS = (deployment as unknown as { contracts: Record<string, string> }).contracts
  .AFTRUSDC?.toLowerCase();
const CIRCLE_USDC_ADDRESS = (deployment as unknown as { external: Record<string, string> }).external
  .umaBondCurrencyCircleUSDC?.toLowerCase();

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
  /** One entry per outcome the wallet holds with balance &gt; 0 */
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

function collateralTickerFor(address: `0x${string}`): string {
  const lower = address.toLowerCase();
  if (lower === zeroAddress.toLowerCase()) return "ETH";
  if (USDEAD_ADDRESS && lower === USDEAD_ADDRESS) return "USDeAD";
  if (CIRCLE_USDC_ADDRESS && lower === CIRCLE_USDC_ADDRESS) return "USDC";
  return "TOKEN";
}

function stateLabel(state: number, stakeEndUnix: number) {
  if (state === 2) return "Settled";
  if (state === 1) return "Resolving (UMA)";
  const now = Math.floor(Date.now() / 1000);
  if (now >= stakeEndUnix) return "Trading closed";
  return "Open";
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

function ClaimWinningsButton({
  marketAddress,
  winningOutcomeIndex,
  maxShares,
  shareDecimals,
  redemptionRate,
  collateralTicker,
  collateralAddress,
  onDone,
}: {
  marketAddress: `0x${string}`;
  winningOutcomeIndex: number;
  maxShares: bigint;
  shareDecimals: number;
  redemptionRate: bigint;
  collateralTicker: string;
  collateralAddress: `0x${string}`;
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

  const redeem = async (withRepay: boolean) => {
    if (!publicClient || !walletClient || !address) { setStatus("Connect wallet."); return; }
    if (chainId !== DEPLOYMENT_CHAIN_ID) { setStatus(`Switch to Base Sepolia.`); return; }
    try {
      setBusy(true);
      setStatus("Preparing…");
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
      setStatus(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <p className="mb-1 text-xs font-semibold text-emerald-400">
        {formatShareAmount(maxShares, shareDecimals)}
      </p>
      <p className="mb-1 text-[11px] text-slate-300">Est. payout: {maxPayout} {collateralTicker}</p>
      {status && <p className="mb-1.5 text-[11px] text-emerald-300">{status}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (isUsdeadMarket) {
            setRepayMode(false);
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-[2px] md:items-center"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1422] p-4 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="absolute right-2 top-2 rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X size={16} weight="bold" />
            </button>
            <p className="text-sm font-semibold text-white">Claim Winnings (USDeAD)</p>
            <p className="mt-1 text-xs text-slate-400">
              Choose to claim only, or claim and repay DRP debt in one transaction.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRepayMode(false);
                }}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                  !repayMode ? "border-emerald-500 bg-emerald-600 text-white" : "border-white/10 text-slate-300"
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
                  repayMode ? "border-indigo-500 bg-indigo-600 text-white" : "border-white/10 text-slate-300"
                }`}
              >
                Claim + Repay
              </button>
            </div>

            <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-black/30 p-3 text-xs">
              <label className="block text-slate-400">Vault collateral token</label>
              <div className="group flex items-center justify-between rounded-md border border-white/10 bg-black px-2 py-1.5 text-white">
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
                  className="opacity-0 transition group-hover:opacity-100 hover:text-emerald-300"
                  title="Copy vault collateral address"
                >
                  <Copy size={14} weight="bold" />
                </button>
              </div>
              {copiedVaultAddress && (
                <p className="text-[11px] text-emerald-300">Vault token address copied</p>
              )}
              {debtLoading ? (
                <p className="text-slate-400">Loading debt…</p>
              ) : (
                <>
                  <p className="text-slate-300">Current debt: <span className="font-semibold text-white">{fmtCollateral(debtWei)} USDeAD</span></p>
                  <p className="text-slate-300">Est. repayable from winnings: <span className="font-semibold text-white">{fmtCollateral(debtToBurnWei)} USDeAD</span></p>
                  <p className="text-slate-300">Est. debt left: <span className="font-semibold text-white">{fmtCollateral(debtLeftAfterWei)} USDeAD</span></p>
                  <p className="text-[11px] text-slate-500">Repay uses DRP 1% fee; estimates account for that.</p>
                </>
              )}
              {debtError && <p className="text-rose-400">{debtError}</p>}
            </div>

            <p className="mt-3 text-[11px] text-slate-400">
              Aftrmarkets is in partnership with{" "}
              <a
                href="https://dead.box"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-emerald-300 underline underline-offset-2"
              >
                DRP
              </a>{" "}
              as a vault manager. Learn more.
            </p>
            <div className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-slate-400">
              {repayMode ? (
                <>
                  This action may require multiple confirmations:
                  <div className="mt-1 space-y-0.5 text-slate-300">
                    <p>1) {shareApprovalReady ? "✓ " : ""}Approve winning shares to router</p>
                    <p>2) {drpApprovalReady ? "✓ " : ""}Approve DRP USDeAD spend</p>
                    <p>3) Execute claim + repay</p>
                  </div>
                </>
              ) : (
                <>
                  This action may require up to two confirmations:
                  <div className="mt-1 space-y-0.5 text-slate-300">
                    <p>1) Approve winning shares to router</p>
                    <p>2) Execute claim</p>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              disabled={busy || (repayMode && debtLoading)}
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
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-md border border-white/10 bg-[#1a1a2e] px-2.5 py-1 text-[10px] font-medium tracking-wide text-zinc-200 opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 whitespace-nowrap">
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
      pageBackgroundClassName="bg-gradient-to-t from-[#2a0f4a] via-[#130a24] to-[#050308]"
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
            No open share balances found for this wallet.
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

              return (
                <article
                  key={g.marketAddress}
                  className="overflow-hidden rounded-2xl border border-[#2a3243] bg-[#111827] p-0 shadow-[0_10px_28px_rgba(2,6,23,0.4)] transition hover:border-[#3a4761]"
                >
                  <div className="aspect-[16/7] w-full overflow-hidden border-b border-[#212a3a] bg-[#0d1422]">
                    {g.imageUrl ? (
                      <img src={g.imageUrl} alt={g.marketTitle} className="h-full w-full object-cover object-center" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="p-2.5">
                    <p className="line-clamp-2 cursor-pointer text-base leading-snug font-semibold text-white underline-offset-2 hover:underline" onClick={() => router.push(`/market/${g.marketAddress}`)}>{g.marketTitle}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {g.marketKind} · {stateLabel(g.marketState, g.stakeEndUnix)}
                    </p>

                    <div className="mt-2 flex items-center justify-between text-xs font-semibold">
                      <span className="text-emerald-400">{chance.toFixed(0)}%</span>
                      <span className="text-rose-400">{(100 - chance).toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full border border-[#445068] bg-[#1a2334] p-[2px]">
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
                            collateralTicker={collateralTickerFor(g.collateralAddress)}
                            collateralAddress={g.collateralAddress}
                            onDone={() => setRefreshKey((k) => k + 1)}
                          />
                        </div>
                      ) : (
                        <p className="mt-2 text-sm font-bold text-rose-400">You Lost</p>
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
                                    ? "border-emerald-500/40 bg-emerald-500/10"
                                    : "border-rose-500/40 bg-rose-500/10"
                                }`}
                              >
                                <p className={`text-[11px] font-semibold uppercase tracking-wide ${idx === 0 ? "text-emerald-200" : "text-rose-200"}`}>
                                  {label}
                                </p>
                                <p className={`mt-0.5 text-[10px] font-medium leading-tight ${has ? "text-white" : "text-slate-500"}`}>
                                  {has ? formatShareAmount(bal, g.collateralDecimals) : "—"}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                        {nOutcomes > 2 && extraPositions.length > 0 && (
                          <div className="mt-2 space-y-1 rounded-lg border border-[#2a3243] bg-[#0f1727] px-2 py-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Other outcomes</p>
                            {extraPositions.map((p) => (
                              <p key={p.outcomeIndex} className="text-xs text-slate-200">
                                <span className="text-slate-400">{g.outcomeLabels[p.outcomeIndex] ?? `Outcome ${p.outcomeIndex + 1}`}:</span>{" "}
                                {formatShareAmount(p.balance, g.collateralDecimals)}
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[#212a3a] bg-[#0f1727] px-2.5 py-1.5 text-[11px] text-slate-300">
                    <Tip label="Total Value Locked">
                      <div className="inline-flex items-center gap-1.5 font-semibold">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-[#4f7cff] to-[#6dff8e]" />
                        {`$${tvlOverrides[g.marketAddress] ?? g.poolTvlDisplay}`}
                      </div>
                    </Tip>
                    <div className="flex items-center gap-2">
                      <Tip label="Refresh TVL">
                        <button type="button" onClick={(e) => { e.stopPropagation(); void refreshTvl(g); }}
                          className="inline-flex items-center transition hover:text-white">
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

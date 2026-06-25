"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Info } from "@phosphor-icons/react";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import { formatUnits, maxUint256, parseUnits, type Address } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import { DEPLOYMENT_CHAIN_ID, wrongNetworkMessage } from "@/lib/deployment";
import { brandPageTitle, brandSectionHeading, brandSectionSubheading } from "@/lib/brand-font";
import { MON_COINGECKO_LOGO } from "@/lib/brand-assets";
import { readVaultSnapshot } from "@/lib/staking-vault-reads";
import {
  ERC20_ABI,
  rewardTokenLabel,
  STAKE_TOKEN_ADDRESS,
  VAULT_ABI,
  VAULT_ADDRESS,
  VAULT_LOCK_DURATION_SEC,
} from "@/lib/staking";

type RewardRow = { token: Address; amount: bigint; symbol: string; logo?: string; decimals: number };

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const days = Math.round(seconds / 86400);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatTimeRemaining(unlockAtSec: bigint, nowSec: number) {
  const remaining = Number(unlockAtSec) - nowSec;
  if (remaining <= 0) return "Ready to withdraw";
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatTokenAmount(raw: bigint, decimals: number, maxFrac = 4) {
  const n = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

function StatusMessage({ message, className = "" }: { message: string; className?: string }) {
  if (!message) return null;
  const isSuccess = /succeeded/i.test(message);
  const isError = /cancelled|failed|Connect|Switch|valid|exceeds/i.test(message);
  return (
    <p
      className={`text-xs leading-relaxed ${
        isSuccess
          ? "font-semibold text-[var(--outcome-yes)]"
          : isError
            ? "text-[var(--outcome-no)]"
            : "text-[var(--muted)]"
      } ${className}`}
    >
      {message}
    </p>
  );
}

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border)]/80 py-3.5 last:border-0 sm:gap-4">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-[var(--muted)]">
        <span className="truncate">{label}</span>
        {hint && (
          <span title={hint} className="shrink-0 cursor-help text-[var(--muted)]">
            <Info size={14} />
          </span>
        )}
      </span>
      <span className="max-w-[55%] shrink-0 text-right text-sm font-semibold tabular-nums leading-snug text-[var(--foreground)] sm:max-w-none">
        {value}
      </span>
    </div>
  );
}

export function StakeClient() {
  const publicClient = deploymentPublicClient;
  const { open } = useWeb3Modal();
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const refreshInFlight = useRef(false);

  const [amount, setAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [stakeStatus, setStakeStatus] = useState("");
  const [secondaryStatus, setSecondaryStatus] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const [walletBalance, setWalletBalance] = useState<bigint>(BigInt(0));
  const [stakedReceipt, setStakedReceipt] = useState<bigint>(BigInt(0));
  const [totalStaked, setTotalStaked] = useState<bigint>(BigInt(0));
  const [currentEpoch, setCurrentEpoch] = useState<bigint>(BigInt(0));
  const [lockDuration, setLockDuration] = useState(VAULT_LOCK_DURATION_SEC);
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [withdrawable, setWithdrawable] = useState<bigint>(BigInt(0));
  const [locked, setLocked] = useState<bigint>(BigInt(0));
  const [nextUnlockAt, setNextUnlockAt] = useState<bigint>(BigInt(0));
  const [stakeDecimals, setStakeDecimals] = useState(18);

  const vaultReady = Boolean(VAULT_ADDRESS && STAKE_TOKEN_ADDRESS && publicClient);

  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (!publicClient || !VAULT_ADDRESS || !STAKE_TOKEN_ADDRESS || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const { meta, snapshot } = await readVaultSnapshot(publicClient, address);
      setStakeDecimals(meta.stakeDecimals);
      setLockDuration(meta.lockDuration);
      setTotalStaked(snapshot.totalStaked);
      setCurrentEpoch(snapshot.currentEpoch);
      setWalletBalance(snapshot.walletBalance);
      setStakedReceipt(snapshot.stakedReceipt);
      setWithdrawable(snapshot.withdrawable);
      setLocked(snapshot.locked);
      setNextUnlockAt(snapshot.nextUnlockAt);

      const rewardRows: RewardRow[] = [];
      for (let i = 0; i < snapshot.earnedTokens.length; i += 1) {
        const token = snapshot.earnedTokens[i]!;
        const amt = snapshot.earnedAmounts[i] ?? BigInt(0);
        if (amt <= BigInt(0)) continue;
        const tokenMeta = rewardTokenLabel(token);
        rewardRows.push({ token, amount: amt, ...tokenMeta });
      }
      setRewards(rewardRows);
      setLoadError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/15\/sec|rate limit|too many/i.test(msg)) {
        setLoadError("Network busy — stats will retry in a moment.");
      } else {
        setLoadError(msg.length > 120 ? "Could not load staking data." : msg);
      }
    } finally {
      refreshInFlight.current = false;
    }
  }, [address, publicClient]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const parsedAmount = useMemo(() => {
    try {
      if (!amount.trim()) return null;
      return parseUnits(amount, stakeDecimals);
    } catch {
      return null;
    }
  }, [amount, stakeDecimals]);

  const parsedWithdraw = useMemo(() => {
    try {
      if (!withdrawAmount.trim()) return null;
      return parseUnits(withdrawAmount, stakeDecimals);
    } catch {
      return null;
    }
  }, [withdrawAmount, stakeDecimals]);

  const willReceive = parsedAmount ?? BigInt(0);
  const totalRewardsWei = rewards.reduce((acc, r) => acc + r.amount, BigInt(0));
  const canWithdrawNow = withdrawable > BigInt(0);
  const withdrawStatusLabel =
    locked === BigInt(0)
      ? canWithdrawNow
        ? "Ready to withdraw"
        : "—"
      : nextUnlockAt > BigInt(0)
        ? formatTimeRemaining(nextUnlockAt, nowSec)
        : "—";

  const runTx = async (
    label: string,
    fn: () => Promise<`0x${string}`>,
    setAreaStatus: (value: string) => void,
  ) => {
    setBusy(true);
    setAreaStatus(`${label}…`);
    try {
      if (chainId !== DEPLOYMENT_CHAIN_ID) throw new Error(wrongNetworkMessage());
      if (!walletClient || !address) throw new Error("Connect wallet first.");
      const hash = await fn();
      setAreaStatus(`Waiting for confirmation…`);
      await publicClient!.waitForTransactionReceipt({ hash });
      setAreaStatus(`${label} succeeded.`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/user rejected/i.test(msg)) setAreaStatus("Transaction cancelled.");
      else setAreaStatus(msg.length > 180 ? `${label} failed.` : msg);
    } finally {
      setBusy(false);
    }
  };

  const handleStake = async () => {
    if (!parsedAmount || parsedAmount <= BigInt(0)) {
      setStakeStatus("Enter a valid stake amount.");
      return;
    }
    const vault = VAULT_ADDRESS;
    const stakeToken = STAKE_TOKEN_ADDRESS;
    if (!vault || !stakeToken) return;

    await runTx(
      "Stake",
      async () => {
      const allowance = (await publicClient!.readContract({
        address: stakeToken,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address!, vault],
      })) as bigint;

      if (allowance < parsedAmount) {
        const approveHash = await walletClient!.writeContract({
          address: stakeToken,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [vault, maxUint256],
          account: address!,
          chain: walletClient!.chain,
        });
        await publicClient!.waitForTransactionReceipt({ hash: approveHash });
      }

      return walletClient!.writeContract({
        address: vault,
        abi: VAULT_ABI,
        functionName: "stake",
        args: [parsedAmount],
        account: address!,
        chain: walletClient!.chain,
      });
    },
      setStakeStatus,
    );
    setAmount("");
  };

  const handleClaim = async () => {
    const vault = VAULT_ADDRESS;
    if (!vault) return;
    await runTx(
      "Claim rewards",
      () =>
      walletClient!.writeContract({
        address: vault,
        abi: VAULT_ABI,
        functionName: "claimRewards",
        account: address!,
        chain: walletClient!.chain,
      }),
      setSecondaryStatus,
    );
  };

  const handleWithdraw = async () => {
    const vault = VAULT_ADDRESS;
    if (!parsedWithdraw || parsedWithdraw <= BigInt(0) || !vault) {
      setSecondaryStatus("Enter a valid withdraw amount.");
      return;
    }
    if (parsedWithdraw > withdrawable) {
      setSecondaryStatus("Amount exceeds withdrawable balance.");
      return;
    }
    await runTx(
      "Withdraw",
      () =>
      walletClient!.writeContract({
        address: vault,
        abi: VAULT_ABI,
        functionName: "withdraw",
        args: [parsedWithdraw],
        account: address!,
        chain: walletClient!.chain,
      }),
      setSecondaryStatus,
    );
    setWithdrawAmount("");
  };

  if (!vaultReady) {
    return (
      <AppLayout showSearch={false}>
        <div className="mx-auto flex min-h-[50vh] max-w-lg items-center justify-center px-4 text-center text-sm text-[var(--muted)]">
          Staking vault is not configured in the current deployment.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showSearch={false} pageBackgroundClassName="aftr-page-bg-gradient">
      <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-8 sm:px-5 md:pb-12 md:pt-12">
        <div className="mb-8 text-center">
          <h1 className={`text-3xl font-bold tracking-tight md:text-4xl ${brandPageTitle}`}>Stake MONDO</h1>
          <p className="mt-2 text-sm text-[var(--muted)] md:text-base">
            Stake MONDO and receive sMONDO while earning a share of protocol fees.
          </p>
        </div>

        {/* Primary stake card */}
        <section className="glass-panel overflow-hidden rounded-3xl">
          <div className="px-4 py-4 sm:px-5 sm:py-5">
            <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">MONDO amount</label>
            <div className="glass-panel-inset mt-2 flex items-center gap-2 rounded-2xl px-3 py-3 sm:gap-3 sm:px-4">
              <img src={MON_COINGECKO_LOGO} alt="MONDO" className="h-7 w-7 shrink-0 rounded-full object-cover sm:h-8 sm:w-8" />
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                className="min-w-0 flex-1 bg-transparent text-xl font-semibold tabular-nums text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]/60 sm:text-2xl"
              />
              <button
                type="button"
                onClick={() =>
                  setAmount(formatUnits(walletBalance, stakeDecimals).replace(/(\.\d{6})\d+$/, "$1"))
                }
                disabled={!address || walletBalance === BigInt(0)}
                className="shrink-0 rounded-full bg-[var(--glass-inset-bg)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--foreground)] transition hover:brightness-110 disabled:opacity-40"
              >
                Max
              </button>
            </div>
            <StatusMessage message={stakeStatus} className="mt-2" />
            {address && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Wallet balance: {formatTokenAmount(walletBalance, stakeDecimals)} MONDO
              </p>
            )}
          </div>

          <div className="px-4 py-4 sm:px-5 sm:py-5">
            {!address ? (
              <button
                type="button"
                onClick={() => void open()}
                className="w-full rounded-2xl bg-[var(--accent)] py-3.5 text-base font-semibold text-white transition hover:opacity-90 sm:py-4"
              >
                Connect wallet
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !parsedAmount || parsedAmount <= BigInt(0)}
                onClick={() => void handleStake()}
                className="w-full rounded-2xl bg-[var(--accent)] py-3.5 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:py-4"
              >
                {busy ? "Processing…" : "Stake MONDO"}
              </button>
            )}
          </div>

          <div className="px-4 py-2 pb-5 sm:px-5 sm:pb-6">
            <StatRow
              label="You will receive"
              value={`${formatTokenAmount(willReceive, stakeDecimals)} sMONDO`}
            />
            <StatRow label="Exchange rate" value="1 MONDO = 1 sMONDO" />
            <StatRow label="Min lock per deposit" value={formatDuration(lockDuration)} />
            <StatRow
              label="Staker fee share"
              hint="Share of protocol fees routed to stakers via the fee vault."
              value="0.2%"
            />
          </div>
        </section>

        {/* Position heading — outside card */}
        <div className="mb-3 mt-8">
          <h2 className={brandSectionHeading}>Your position</h2>
          <p className={`mt-1 ${brandSectionSubheading}`}>Protocol totals and your staking stats</p>
        </div>

        {/* Stats + actions card */}
        <section className="glass-panel overflow-hidden rounded-3xl">
          <div className="px-4 py-2 pb-1 sm:px-5 sm:py-3">
            <StatRow
              label="Total staked (protocol)"
              value={`${formatTokenAmount(totalStaked, stakeDecimals)} MONDO`}
            />
            <StatRow label="Your stake" value={`${formatTokenAmount(stakedReceipt, stakeDecimals)} sMONDO`} />
            <StatRow label="Current epoch" value={currentEpoch.toString()} />
            <StatRow
              label="Claimable rewards"
              value={
                rewards.length === 0
                  ? "0"
                  : rewards
                      .map((r) => `${formatTokenAmount(r.amount, r.decimals, 6)} ${r.symbol}`)
                      .join(" · ")
              }
            />
            {address && (
              <>
                <StatRow
                  label="Withdrawable now"
                  value={`${formatTokenAmount(withdrawable, stakeDecimals)} MONDO`}
                />
                <StatRow
                  label="Still locked"
                  value={`${formatTokenAmount(locked, stakeDecimals)} MONDO`}
                />
                <StatRow
                  label={canWithdrawNow && locked > BigInt(0) ? "Next unlock in" : "Withdraw status"}
                  value={withdrawStatusLabel}
                />
              </>
            )}
          </div>

          {address && (
            <div className="space-y-4 px-4 py-4 pb-5 sm:px-5 sm:py-5 sm:pb-6">
              <button
                type="button"
                disabled={busy || totalRewardsWei === BigInt(0)}
                onClick={() => void handleClaim()}
                className="w-full rounded-xl border border-emerald-500/35 bg-emerald-500/10 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-40 [html[data-theme=light]_&]:text-emerald-800"
              >
                Claim fees
              </button>

              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Withdraw amount (MONDO)
                </label>
                <div className="relative mt-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    className="glass-panel-inset w-full rounded-xl py-2.5 pl-3 pr-12 text-sm tabular-nums text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    disabled={!address || withdrawable === BigInt(0)}
                    onClick={() =>
                      setWithdrawAmount(
                        formatUnits(withdrawable, stakeDecimals).replace(/(\.\d{6})\d+$/, "$1"),
                      )
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--accent)] transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Max
                  </button>
                </div>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !parsedWithdraw ||
                    parsedWithdraw <= BigInt(0) ||
                    parsedWithdraw > withdrawable
                  }
                  onClick={() => void handleWithdraw()}
                  className="mt-2 w-full rounded-xl bg-[var(--glass-inset-bg)] py-3 text-sm font-semibold text-[var(--foreground)] transition hover:brightness-110 disabled:opacity-40"
                >
                  Withdraw MONDO
                </button>
                {withdrawable === BigInt(0) && stakedReceipt > BigInt(0) && (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {locked > BigInt(0) && nextUnlockAt > BigInt(0)
                      ? `Earliest unlock in ${formatTimeRemaining(nextUnlockAt, nowSec)}.`
                      : `Each deposit unlocks after ${formatDuration(lockDuration)}.`}
                  </p>
                )}
                <StatusMessage message={secondaryStatus} className="mt-2" />
              </div>
            </div>
          )}
        </section>

        {loadError && (
          <p className="mt-4 text-center text-sm text-amber-400">{loadError}</p>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-[var(--muted)] sm:text-sm">
          sMONDO is non-transferable. Each deposit has its own {formatDuration(lockDuration)} lock — topping up
          does not reset earlier deposits. Withdraw instantly once a lot unlocks.{" "}
          <Link href="/how-it-works#stakers" className="text-[var(--accent)] hover:underline">
            Learn more
          </Link>
        </p>
      </div>
    </AppLayout>
  );
}

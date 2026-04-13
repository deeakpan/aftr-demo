"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise, BookmarkSimple, PlusMinus } from "@phosphor-icons/react";
import { formatUnits, parseAbi, parseUnits } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import deployment from "@/deployments/baseSepolia-84532.json";

const FACTORY_ADDRESS = deployment.contracts.AFTRParimutuelMarketFactory as `0x${string}`;
const DEPLOYMENT_CHAIN_ID = deployment.chainId;

const FACTORY_ABI = parseAbi([
  "function marketsLength() view returns (uint256)",
  "function markets(uint256) view returns (address)",
]);

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

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

type PositionRow = {
  marketAddress: `0x${string}`;
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

type IpfsMetadata = {
  title?: string;
  description?: string;
  image?: string;
  outcomes?: string[];
};

type MarketPositionGroup = {
  marketAddress: `0x${string}`;
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

function ipfsToHttp(uri: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.lighthouse.storage/ipfs/${uri.replace("ipfs://", "")}`;
  }
  return uri;
}

async function fetchMetadata(uri: string): Promise<IpfsMetadata | null> {
  const url = ipfsToHttp(uri);
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as IpfsMetadata;
  } catch {
    return null;
  }
}

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

function RedeemWinningShares({
  marketAddress,
  winningOutcomeIndex,
  maxShares,
  shareDecimals,
  onDone,
}: {
  marketAddress: `0x${string}`;
  winningOutcomeIndex: number;
  maxShares: bigint;
  shareDecimals: number;
  onDone: () => void;
}) {
  const publicClient = usePublicClient({ chainId: DEPLOYMENT_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const { address, chainId } = useAccount();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const redeemWei = useMemo(() => {
    const t = amount.trim();
    if (!t) return null;
    try {
      return parseUnits(t, shareDecimals);
    } catch {
      return null;
    }
  }, [amount, shareDecimals]);

  const redeem = async () => {
    if (!publicClient || !walletClient || !address) {
      setStatus("Connect wallet.");
      return;
    }
    if (chainId !== DEPLOYMENT_CHAIN_ID) {
      setStatus(`Switch to Base Sepolia (${DEPLOYMENT_CHAIN_ID}).`);
      return;
    }
    if (!redeemWei || redeemWei <= BigInt(0)) {
      setStatus("Enter a valid share amount.");
      return;
    }
    if (redeemWei > maxShares) {
      setStatus("Amount exceeds your balance.");
      return;
    }
    try {
      setBusy(true);
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
      if (allowance < redeemWei) {
        setStatus("Approving market…");
        const h = await walletClient.writeContract({
          chain: walletClient.chain,
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [marketAddress, redeemWei],
          account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      setStatus("Redeeming…");
      const tx = await walletClient.writeContract({
        chain: walletClient.chain,
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "redeem",
        args: [winningOutcomeIndex, redeemWei],
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("Redeemed.");
      setAmount("");
      onDone();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Redeem failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200">Redeem winner</p>
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Share amount"
        className="mt-1.5 w-full rounded-md border border-[#2a3243] bg-[#0f1727] px-2 py-1 text-xs text-white outline-none"
      />
      {status ? <p className="mt-1 text-[10px] text-slate-400">{status}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          void redeem();
        }}
        className="mt-2 w-full rounded-md bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "…" : "Redeem"}
      </button>
    </div>
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
        const total = Number(
          await publicClient.readContract({
            address: FACTORY_ADDRESS,
            abi: FACTORY_ABI,
            functionName: "marketsLength",
          }),
        );
        const marketAddresses = await Promise.all(
          Array.from({ length: total }, (_, i) =>
            publicClient.readContract({
              address: FACTORY_ADDRESS,
              abi: FACTORY_ABI,
              functionName: "markets",
              args: [BigInt(total - 1 - i)],
            }) as Promise<`0x${string}`>,
          ),
        );

        const allRows: PositionRow[] = [];
        for (const marketAddress of marketAddresses) {
          const [
            kindRaw,
            stateRaw,
            stakeEndRaw,
            outcomesRaw,
            collateralDecimalsRaw,
            winningRaw,
            redemptionRate,
            metadataUri,
          ] = await Promise.all([
            publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "marketKind" }),
            publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "state" }),
            publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "stakeEndTimestamp" }),
            publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "numOutcomes" }),
            publicClient.readContract({
              address: marketAddress,
              abi: MARKET_ABI,
              functionName: "collateralDecimals",
            }),
            publicClient.readContract({
              address: marketAddress,
              abi: MARKET_ABI,
              functionName: "winningOutcomeIndex",
            }),
            publicClient.readContract({
              address: marketAddress,
              abi: MARKET_ABI,
              functionName: "redemptionRate",
            }),
            publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "metadataURI" }),
          ]);

          const numOutcomes = Number(outcomesRaw);
          const collateralDecimals = Number(collateralDecimalsRaw);
          const state = Number(stateRaw);
          const kind = Number(kindRaw) === 0 ? "Price" : "Event";
          const metadata = await fetchMetadata(String(metadataUri || ""));
          const marketTitle = metadata?.title?.trim() || `${kind} market`;
          const labels = metadata?.outcomes?.filter((x): x is string => typeof x === "string") ?? [];
          const fallbackLabels = Array.from({ length: numOutcomes }, (_, i) => `Outcome ${i + 1}`);
          const outcomeLabels = labels.length > 0 ? labels : fallbackLabels;

          let chancePct = numOutcomes >= 2 ? 50 : Math.max(1, Math.round(100 / Math.max(1, numOutcomes)));
          try {
            const p0 = await publicClient.readContract({
              address: marketAddress,
              abi: MARKET_ABI,
              functionName: "priceOf",
              args: [0],
            });
            chancePct = clampPct(Number(formatUnits(p0 as bigint, 18)) * 100);
          } catch {
            // keep fallback
          }

          const realPoolParts = await Promise.all(
            Array.from({ length: numOutcomes }, (_, i) =>
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "realPool",
                args: [BigInt(i)],
              }),
            ),
          );
          const poolTvlRaw = realPoolParts.reduce((acc, v) => acc + (v as bigint), BigInt(0));
          const poolTvlDisplay = Number(formatUnits(poolTvlRaw, collateralDecimals)).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          });
          const stakeEndUnix = Number(stakeEndRaw);
          const stakeEndsLabel = fmtTs(stakeEndUnix);
          const imageUrl = ipfsToHttp(metadata?.image?.trim() || "");

          const winningOutcomeIndex = state === 2 ? Number(winningRaw) : null;
          const outcomeTokens = await Promise.all(
            Array.from({ length: numOutcomes }, (_, i) =>
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "outcomeToken",
                args: [BigInt(i)],
              }) as Promise<`0x${string}`>,
            ),
          );

          for (let i = 0; i < outcomeTokens.length; i += 1) {
            const bal = (await publicClient.readContract({
              address: outcomeTokens[i]!,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [address],
            })) as bigint;
            if (bal <= BigInt(0)) continue;
            allRows.push({
              marketAddress,
              marketTitle,
              marketKind: kind,
              marketState: state,
              stakeEndUnix,
              winningOutcomeIndex,
              redemptionRate: redemptionRate as bigint,
              outcomeIndex: i,
              outcomeLabel: outcomeLabels[i] ?? `Outcome ${i + 1}`,
              outcomeLabels,
              balance: bal,
              collateralDecimals,
              chancePct,
              poolTvlDisplay,
              stakeEndsLabel,
              imageUrl,
            });
          }
        }

        setRows(allRows);
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
    <AppLayout showSearch={false}>
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
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/market/${g.marketAddress}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/market/${g.marketAddress}`);
                    }
                  }}
                  className="cursor-pointer overflow-hidden rounded-2xl border border-[#2a3243] bg-[#111827] p-0 shadow-[0_10px_28px_rgba(2,6,23,0.4)] transition hover:border-[#3a4761]"
                >
                  <div className="h-[5.5rem] w-full overflow-hidden border-b border-[#212a3a] bg-[#0d1422]">
                    {g.imageUrl ? (
                      <img src={g.imageUrl} alt={g.marketTitle} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="p-2.5">
                    <p className="line-clamp-2 text-base leading-snug font-semibold text-white">{g.marketTitle}</p>
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

                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {g.outcomeLabels.slice(0, 2).map((label, idx) => {
                        const bal = balanceForOutcome(g.positions, idx);
                        const has = bal > BigInt(0);
                        const isWinner =
                          g.marketState === 2 && g.winningOutcomeIndex === idx && has;
                        const isLoser =
                          g.marketState === 2 && g.winningOutcomeIndex !== null && g.winningOutcomeIndex !== idx && has;

                        return (
                          <div
                            key={`${g.marketAddress}-${label}`}
                            className={`rounded-md border px-1.5 py-1 text-center ${
                              idx === 0
                                ? "border-emerald-500/40 bg-emerald-500/10"
                                : "border-rose-500/40 bg-rose-500/10"
                            }`}
                          >
                            <p
                              className={`text-[11px] font-semibold uppercase tracking-wide ${
                                idx === 0 ? "text-emerald-200" : "text-rose-200"
                              }`}
                            >
                              {label}
                            </p>
                            <p className={`mt-0.5 text-[10px] font-medium leading-tight ${has ? "text-white" : "text-slate-500"}`}>
                              {has ? formatShareAmount(bal, g.collateralDecimals) : "—"}
                            </p>
                            {g.marketState === 2 && has && (
                              <p className="mt-0.5 text-[10px] text-slate-400">
                                {isWinner
                                  ? `Winner · rate ${formatUnits(g.redemptionRate, 18)}`
                                  : isLoser
                                    ? "Losing outcome"
                                    : ""}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {nOutcomes > 2 && extraPositions.length > 0 && (
                      <div className="mt-2 space-y-1 rounded-lg border border-[#2a3243] bg-[#0f1727] px-2 py-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Other outcomes
                        </p>
                        {extraPositions.map((p) => (
                          <p key={p.outcomeIndex} className="text-xs text-slate-200">
                            <span className="text-slate-400">{g.outcomeLabels[p.outcomeIndex] ?? `Outcome ${p.outcomeIndex + 1}`}:</span>{" "}
                            {formatShareAmount(p.balance, g.collateralDecimals)}
                          </p>
                        ))}
                      </div>
                    )}

                    {g.marketState === 2 && winIdx !== null && winBal > BigInt(0) && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <RedeemWinningShares
                          marketAddress={g.marketAddress}
                          winningOutcomeIndex={winIdx}
                          maxShares={winBal}
                          shareDecimals={g.collateralDecimals}
                          onDone={() => setRefreshKey((k) => k + 1)}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[#212a3a] bg-[#0f1727] px-2.5 py-1.5 text-[11px] text-slate-300">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-[#4f7cff] to-[#6dff8e]" />
                      {`TVL $${g.poolTvlDisplay}`}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-0.5">
                        <ArrowsClockwise size={12} /> {g.stakeEndsLabel}
                      </span>
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

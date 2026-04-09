"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, BookmarkSimple, Gift, TrendUp } from "@phosphor-icons/react";
import { formatUnits, parseAbi, parseUnits, zeroAddress } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { hasWalletConnectProjectId } from "../providers";
import { AppLayout } from "@/app/components/app-layout";
import { TradeModal } from "@/app/market/components/trade-modal";
import deployment from "@/deployments/baseSepolia-84532.json";

const DEPLOYMENT_CHAIN_ID = deployment.chainId;
const FACTORY_ADDRESS = deployment.contracts.AFTRParimutuelMarketFactory as `0x${string}`;
const FACTORY_ABI = parseAbi([
  "function marketsLength() view returns (uint256)",
  "function markets(uint256) view returns (address)",
]);
const MARKET_ABI = parseAbi([
  "function marketKind() view returns (uint8)",
  "function metadataURI() view returns (string)",
  "function stakeEndTimestamp() view returns (uint256)",
  "function resolveAfterTimestamp() view returns (uint256)",
  "function numOutcomes() view returns (uint8)",
  "function state() view returns (uint8)",
  "function collateralDecimals() view returns (uint8)",
  "function virtualReserve() view returns (uint256)",
  "function priceOf(uint8 outcomeIndex) view returns (uint256)",
  "function deposit(uint8 outcomeIndex, uint256 amount, address recipient, uint256 minSharesOut) payable",
  "function collateralAddress() view returns (address)",
  "function priceBinLower(uint256) view returns (uint256)",
  "function priceBinUpper(uint256) view returns (uint256)",
]);
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

const WAD = BigInt("1000000000000000000");
const SLIPPAGE_PRESETS = [50, 100, 200, 300] as const;

type UiMarket = {
  address: `0x${string}`;
  kind: "Event" | "Price";
  outcomes: number;
  outcomeLabels: string[];
  title: string;
  description: string;
  imageUrl: string;
  stakeEnds: string;
  resolveAfter: string;
  /** Unix seconds — `deposit` reverts after this. */
  stakeEndUnix: number;
  /** Unix seconds — matches modal "Expires". */
  resolveAfterUnix: number;
  marketState: number;
  stateLabel: string;
  virtualReserve: string;
  chancePct: number;
  collateralAddress: `0x${string}`;
  collateralDecimals: number;
  /** Formatted bin strings per outcome for price markets (Chainlink-style 8-decimal bounds). */
  priceBinByOutcome?: string[];
};

type IpfsMetadata = {
  title?: string;
  description?: string;
  image?: string;
  outcomes?: string[];
};

function fmtTs(value: bigint) {
  const ms = Number(value) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  return new Date(ms).toLocaleString();
}

function stateLabel(state: number) {
  switch (state) {
    case 0:
      return "Open";
    case 1:
      return "Awaiting resolution";
    case 2:
      return "Settled";
    case 3:
      return "Cancelled";
    default:
      return `State ${state}`;
  }
}

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, v));
}

function ipfsToHttp(uri: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "");
    return `https://gateway.lighthouse.storage/ipfs/${cid}`;
  }
  return uri;
}

function fmtUsdBin(value: bigint): string {
  const n = Number(formatUnits(value, 8));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatMoneyAmount(unformatted: string, ticker: string): string {
  const n = Number(unformatted);
  if (!Number.isFinite(n)) return unformatted;
  const compact = n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (ticker === "USDC") return `$${compact}`;
  return `${compact} ${ticker}`;
}

async function fetchIpfsMetadata(uri: string): Promise<IpfsMetadata | null> {
  const httpUrl = ipfsToHttp(uri);
  if (!httpUrl) return null;
  try {
    const res = await fetch(httpUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as IpfsMetadata;
    return data;
  } catch {
    return null;
  }
}

export function MarketClient() {
  const publicClient = usePublicClient({ chainId: DEPLOYMENT_CHAIN_ID });
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [markets, setMarkets] = useState<UiMarket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedMarket, setSelectedMarket] = useState<UiMarket | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeStatus, setTradeStatus] = useState("");
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradePriceRaw, setTradePriceRaw] = useState<bigint | null>(null);
  const [collateralBalance, setCollateralBalance] = useState<bigint | null>(null);
  const [collateralAllowance, setCollateralAllowance] = useState<bigint | null>(null);
  const [tradeSlippageBps, setTradeSlippageBps] = useState(200);
  /** Bumps on an interval while the trade modal is open so expiry / stake-end disables react to wall clock. */
  const [tradeModalClock, setTradeModalClock] = useState(0);

  useEffect(() => {
    const run = async () => {
      if (!publicClient) return;
      setIsLoading(true);
      setLoadError("");
      try {
        const total = Number(
          await publicClient.readContract({
            address: FACTORY_ADDRESS,
            abi: FACTORY_ABI,
            functionName: "marketsLength",
          }),
        );

        const addresses = await Promise.all(
          Array.from({ length: total }, (_, idx) =>
            publicClient.readContract({
              address: FACTORY_ADDRESS,
              abi: FACTORY_ABI,
              functionName: "markets",
              args: [BigInt(total - 1 - idx)],
            }),
          ),
        );

        const rows = await Promise.all(
          addresses.map(async (marketAddress) => {
            const [kind, uri, stake, resolveAfter, outcomes, state, collateralDecimals, reserve] = await Promise.all([
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "marketKind",
              }),
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "metadataURI",
              }),
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "stakeEndTimestamp",
              }),
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "resolveAfterTimestamp",
              }),
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "numOutcomes",
              }),
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "state",
              }),
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "collateralDecimals",
              }),
              publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "virtualReserve",
              }),
            ]);
            const metadataUri = String(uri || "");
            const md = await fetchIpfsMetadata(metadataUri);
            const outcomeCount = Number(outcomes);
            const fallbackLabels = Array.from({ length: outcomeCount }, (_, i) => `Outcome ${i + 1}`);
            const labelsFromIpfs =
              md?.outcomes && md.outcomes.length > 0 ? md.outcomes.filter((x): x is string => typeof x === "string") : [];
            const safeOutcomeLabels =
              labelsFromIpfs.length > 0 ? labelsFromIpfs : fallbackLabels;
            const isPrice = Number(kind) === 0;
            let priceBinByOutcome: string[] | undefined;
            if (isPrice) {
              try {
                const lowers = await Promise.all(
                  Array.from({ length: outcomeCount }, (_, i) =>
                    publicClient.readContract({
                      address: marketAddress,
                      abi: MARKET_ABI,
                      functionName: "priceBinLower",
                      args: [BigInt(i)],
                    }),
                  ),
                );
                const uppers = await Promise.all(
                  Array.from({ length: outcomeCount }, (_, i) =>
                    publicClient.readContract({
                      address: marketAddress,
                      abi: MARKET_ABI,
                      functionName: "priceBinUpper",
                      args: [BigInt(i)],
                    }),
                  ),
                );
                priceBinByOutcome = lowers.map((lo, i) => {
                  return `$${fmtUsdBin(lo as bigint)} — $${fmtUsdBin(uppers[i] as bigint)}`;
                });
              } catch {
                priceBinByOutcome = undefined;
              }
            }
            let leftPct = outcomeCount >= 2 ? 50 : Math.max(1, Math.round(100 / Math.max(1, outcomeCount)));
            try {
              const p0 = await publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "priceOf",
                args: [0],
              });
              leftPct = clampPct(Number(formatUnits(p0 as bigint, 18)) * 100);
            } catch {
              // keep fallback percentage
            }
            return {
              address: marketAddress,
              kind: isPrice ? "Price" : "Event",
              outcomes: outcomeCount,
              outcomeLabels: safeOutcomeLabels,
              title: md?.title?.trim() || `${isPrice ? "Price" : "Event"} market`,
              description: md?.description?.trim() || "No description provided.",
              imageUrl: ipfsToHttp(md?.image?.trim() || ""),
              stakeEnds: fmtTs(stake as bigint),
              resolveAfter: fmtTs(resolveAfter as bigint),
              stakeEndUnix: Number(stake as bigint),
              resolveAfterUnix: Number(resolveAfter as bigint),
              marketState: Number(state),
              stateLabel: stateLabel(Number(state)),
              virtualReserve: Number(formatUnits(reserve as bigint, Number(collateralDecimals))).toLocaleString(
                undefined,
                { maximumFractionDigits: 2 },
              ),
              chancePct: leftPct,
              collateralAddress: (await publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "collateralAddress",
              })) as `0x${string}`,
              collateralDecimals: Number(collateralDecimals),
              priceBinByOutcome,
            } satisfies UiMarket;
          }),
        );
        setMarkets(rows);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load markets.");
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, [publicClient]);

  useEffect(() => {
    if (!selectedMarket) return;
    const id = setInterval(() => setTradeModalClock((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [selectedMarket]);

  useEffect(() => {
    if (!selectedMarket || !publicClient) {
      setTradePriceRaw(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const p = await publicClient.readContract({
          address: selectedMarket.address,
          abi: MARKET_ABI,
          functionName: "priceOf",
          args: [selectedOutcome],
        });
        if (!cancelled) setTradePriceRaw(p as bigint);
      } catch {
        if (!cancelled) setTradePriceRaw(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMarket, selectedOutcome, publicClient]);

  useEffect(() => {
    if (!selectedMarket || !publicClient || !address) {
      setCollateralBalance(null);
      setCollateralAllowance(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (selectedMarket.collateralAddress.toLowerCase() === zeroAddress) {
          const b = await publicClient.getBalance({ address });
          if (!cancelled) {
            setCollateralBalance(b);
            setCollateralAllowance(null);
          }
          return;
        }
        const [b, a] = await Promise.all([
          publicClient.readContract({
            address: selectedMarket.collateralAddress,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: selectedMarket.collateralAddress,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, selectedMarket.address],
          }) as Promise<bigint>,
        ]);
        if (!cancelled) {
          setCollateralBalance(b);
          setCollateralAllowance(a);
        }
      } catch {
        if (!cancelled) {
          setCollateralBalance(null);
          setCollateralAllowance(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMarket, address, publicClient, tradeBusy, tradeAmount, selectedOutcome]);

  const empty = useMemo(() => !isLoading && !loadError && markets.length === 0, [isLoading, loadError, markets.length]);

  const tradeSummary = useMemo(() => {
    if (!selectedMarket || !tradePriceRaw || tradePriceRaw === 0n) return null;
    const t = tradeAmount.trim();
    if (!t || !Number.isFinite(Number(t)) || Number(t) <= 0) return null;
    try {
      const amountWei = parseUnits(t, selectedMarket.collateralDecimals);
      const sharesWei = (amountWei * WAD) / tradePriceRaw;
      if (sharesWei === 0n) return null;
      return {
        spend: formatUnits(amountWei, selectedMarket.collateralDecimals),
        tokens: formatUnits(sharesWei, selectedMarket.collateralDecimals),
        amountWei,
        sharesWei,
      };
    } catch {
      return null;
    }
  }, [selectedMarket, tradePriceRaw, tradeAmount]);

  const pricePerTokenLabel = useMemo(() => {
    if (!tradeSummary || tradeSummary.sharesWei === 0n) return null;
    const raw = (tradeSummary.amountWei * WAD) / tradeSummary.sharesWei;
    const s = formatUnits(raw, 18);
    const ticker =
      selectedMarket?.collateralAddress?.toLowerCase() === zeroAddress ? "ETH" : "USDC";
    return formatMoneyAmount(s, ticker);
  }, [tradeSummary, selectedMarket?.collateralAddress]);

  const cycleSlippage = () => {
    setTradeSlippageBps((prev) => {
      const idx = SLIPPAGE_PRESETS.indexOf(prev as (typeof SLIPPAGE_PRESETS)[number]);
      const i = idx < 0 ? 0 : (idx + 1) % SLIPPAGE_PRESETS.length;
      return SLIPPAGE_PRESETS[i]!;
    });
  };

  const isNativeCollateral = Boolean(
    selectedMarket?.collateralAddress?.toLowerCase() === zeroAddress,
  );

  const needsApproval = Boolean(
    selectedMarket &&
      !isNativeCollateral &&
      tradeSummary &&
      collateralAllowance !== null &&
      collateralAllowance < tradeSummary.amountWei,
  );

  const approvalIcon = useMemo(() => {
    if (isNativeCollateral || !address) return "none" as const;
    if (collateralAllowance === null) return "none" as const;
    if (!tradeSummary) return "none" as const;
    return needsApproval ? ("warn" as const) : ("ok" as const);
  }, [isNativeCollateral, address, collateralAllowance, tradeSummary, needsApproval]);

  const tradeDisabled = useMemo(() => {
    void tradeModalClock;
    if (!selectedMarket) return false;
    const now = Math.floor(Date.now() / 1000);
    if (selectedMarket.marketState !== 0) return true;
    if (now >= selectedMarket.resolveAfterUnix) return true;
    if (now >= selectedMarket.stakeEndUnix) return true;
    return false;
  }, [selectedMarket, tradeModalClock]);

  const approvalLine = useMemo(() => {
    if (!selectedMarket) return "";
    const tick = isNativeCollateral ? "ETH" : "USDC";
    if (isNativeCollateral) return "Native collateral — no token approval.";
    if (!address || !tradeSummary) return "";
    if (collateralAllowance === null) return "Loading allowance…";
    const cur = formatUnits(collateralAllowance, selectedMarket.collateralDecimals);
    const req = tradeSummary.spend;
    const enough = collateralAllowance >= tradeSummary.amountWei;
    return enough
      ? `Sufficient · ${cur} ${tick} covers ${req} ${tick}`
      : `Approve first · ${cur} ${tick} allowance, need ${req} ${tick}`;
  }, [selectedMarket, address, collateralAllowance, tradeSummary, isNativeCollateral]);

  const openTrade = (market: UiMarket, outcomeIndex: number) => {
    setSelectedMarket(market);
    setSelectedOutcome(outcomeIndex);
    setTradeAmount("");
    setTradeStatus("");
  };

  const submitTrade = async () => {
    if (!selectedMarket || !publicClient || !walletClient || !address) {
      setTradeStatus("Connect wallet first.");
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    if (selectedMarket.marketState !== 0) {
      setTradeStatus(`Market is ${selectedMarket.stateLabel.toLowerCase()}.`);
      return;
    }
    if (now >= selectedMarket.resolveAfterUnix || now >= selectedMarket.stakeEndUnix) {
      setTradeStatus("Trading closed for this market.");
      return;
    }
    if (chainId !== DEPLOYMENT_CHAIN_ID) {
      setTradeStatus(`Switch to Base Sepolia (${DEPLOYMENT_CHAIN_ID}).`);
      return;
    }
    if (!tradeAmount || Number(tradeAmount) <= 0) {
      setTradeStatus("Enter a valid amount.");
      return;
    }

    try {
      setTradeBusy(true);
      setTradeStatus("Preparing trade...");
      const amountUnits = parseUnits(tradeAmount, selectedMarket.collateralDecimals);
      const currentPrice = (await publicClient.readContract({
        address: selectedMarket.address,
        abi: MARKET_ABI,
        functionName: "priceOf",
        args: [selectedOutcome],
      })) as bigint;
      const estShares = (amountUnits * WAD) / currentPrice;
      const slipBps = Math.min(5000, Math.max(1, tradeSlippageBps));
      const minSharesOut = (estShares * BigInt(10_000 - slipBps)) / 10_000n;

      const isNative = selectedMarket.collateralAddress.toLowerCase() === "0x0000000000000000000000000000000000000000";
      if (!isNative) {
        const allowance = (await publicClient.readContract({
          address: selectedMarket.collateralAddress,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, selectedMarket.address],
        })) as bigint;
        if (allowance < amountUnits) {
          setTradeStatus("Approve collateral...");
          const approveHash = await walletClient.writeContract({
            chain: walletClient.chain,
            address: selectedMarket.collateralAddress,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [selectedMarket.address, amountUnits],
            account: address,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      setTradeStatus("Submitting trade...");
      const txHash = await walletClient.writeContract({
        chain: walletClient.chain,
        address: selectedMarket.address,
        abi: MARKET_ABI,
        functionName: "deposit",
        args: [selectedOutcome, amountUnits, address, minSharesOut],
        account: address,
        value: isNative ? amountUnits : undefined,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setTradeStatus("Trade successful.");
      setTradeAmount("");
    } catch (error) {
      setTradeStatus(error instanceof Error ? error.message : "Trade failed.");
    } finally {
      setTradeBusy(false);
    }
  };

  return (
    <AppLayout showFilterStrip searchPlaceholder="Search markets... (Ctrl/Cmd + K)">
      <section className="mx-4 pt-8 md:mx-6">
        <div className="mb-2 flex items-center gap-2">
          <TrendUp size={22} weight="bold" className="text-[var(--accent)]" />
          <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)] md:text-2xl">
            Markets
          </h1>
        </div>
        {isLoading && <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)]">Loading markets...</p>}
        {loadError && <p className="max-w-xl text-sm leading-relaxed text-red-400">{loadError}</p>}
        {empty && <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)]">No markets yet.</p>}
        {markets.length > 0 && (
          <div className="mt-5 grid max-w-[900px] gap-4 md:grid-cols-2">
            {markets.map((m) => {
              const chance = Number.isFinite(m?.chancePct) ? m.chancePct : 50;
              return (
                <article
                  key={m.address}
                  className="overflow-hidden rounded-3xl border border-[#2a3243] bg-[#111827] p-0 shadow-[0_14px_40px_rgba(2,6,23,0.45)] transition hover:border-[#3a4761]"
                >
                <div className="h-28 w-full overflow-hidden border-b border-[#212a3a] bg-[#0d1422]">
                  {m.imageUrl ? (
                    <img src={m.imageUrl} alt={m.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                      No image
                    </div>
                  )}
                </div>

                <div className="p-3.5">
                  <p className="line-clamp-2 text-xl leading-tight font-semibold text-white">
                    {m.title}
                  </p>

                  <div className="mt-3 flex items-center justify-between text-sm font-semibold">
                    <span className="text-emerald-400">{chance.toFixed(0)}%</span>
                    <span className="text-rose-400">{(100 - chance).toFixed(0)}%</span>
                  </div>
                  <div className="mt-1.5 h-2.5 rounded-full border border-[#445068] bg-[#1a2334] p-[2px]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500/70 to-rose-500/70"
                      style={{ width: `${chance}%` }}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    {(m.outcomeLabels ?? []).slice(0, 2).map((label, idx) => (
                      <button
                        key={`${m.address}-${label}`}
                        type="button"
                        onClick={() => openTrade(m, idx)}
                        className={`rounded-xl border px-3 py-2.5 text-center text-lg font-semibold uppercase tracking-wide transition ${
                          idx === 0
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:border-emerald-500 hover:bg-emerald-600 hover:text-white"
                            : "border-rose-500/40 bg-rose-500/10 text-rose-200 hover:border-rose-500 hover:bg-rose-600 hover:text-white"
                        }`}
                      >
                        {label.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-[#212a3a] bg-[#0f1727] px-3.5 py-2 text-xs text-slate-300">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#4f7cff] to-[#6dff8e]" />
                    +${m.virtualReserve}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <ArrowsClockwise size={14} /> ${m.virtualReserve}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Gift size={14} /> {m.resolveAfter}
                    </span>
                    <BookmarkSimple size={14} />
                  </div>
                </div>
              </article>
              );
            })}
          </div>
        )}
        {!hasWalletConnectProjectId && (
          <p className="mt-4 text-sm text-red-400">
            Add <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs">NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</code>{" "}
            in <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs">.env</code>, then restart the dev server.
          </p>
        )}
      </section>
      <TradeModal
        open={Boolean(selectedMarket)}
        onClose={() => {
          setSelectedMarket(null);
          setTradeStatus("");
          setTradeAmount("");
        }}
        marketTitle={selectedMarket?.title ?? "Trade"}
        priceRangeLine={selectedMarket?.priceBinByOutcome?.[selectedOutcome] ?? null}
        stakeEnds={selectedMarket?.stakeEnds ?? "—"}
        resolveAfter={selectedMarket?.resolveAfter ?? "—"}
        outcomeLabels={selectedMarket?.outcomeLabels ?? []}
        selectedOutcomeIndex={selectedOutcome}
        onSelectOutcome={setSelectedOutcome}
        collateralDecimals={selectedMarket?.collateralDecimals ?? 6}
        collateralTicker={
          selectedMarket?.collateralAddress?.toLowerCase() === zeroAddress ? "ETH" : "USDC"
        }
        amount={tradeAmount}
        setAmount={setTradeAmount}
        priceOfRaw={tradePriceRaw}
        walletBalanceWei={collateralBalance}
        tokensFormatted={tradeSummary?.tokens ?? null}
        pricePerTokenLabel={pricePerTokenLabel}
        slippageBps={tradeSlippageBps}
        onCycleSlippage={cycleSlippage}
        isNativeCollateral={isNativeCollateral}
        needsApproval={needsApproval}
        approvalIcon={approvalIcon}
        approvalLine={approvalLine}
        tradeDisabled={tradeDisabled}
        status={tradeStatus}
        busy={tradeBusy}
        onSubmit={() => {
          void submitTrade();
        }}
      />
    </AppLayout>
  );
}

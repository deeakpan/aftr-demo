"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TrendUp } from "@phosphor-icons/react";
import { formatUnits, parseAbi, parseUnits, zeroAddress } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { hasWalletConnectProjectId } from "@/app/wagmi-config";
import { AppLayout } from "@/app/components/app-layout";
import { MarketListCard, MarketListCardSkeleton } from "@/app/market/components/market-list-card";
import { LimitOrderParams, TradeModal, type TradeSuccessResult } from "@/app/market/components/trade-modal";
import {
  collateralTickerFromDeployment,
  isUsdStyledCollateralTicker,
} from "@/lib/deployment-collateral";
import { deploymentPublicClient, readMarketPrice } from "@/lib/deployment-public-client";
import deployment, { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL, wrongNetworkMessage } from "@/lib/deployment";
import { brandPageTitle } from "@/lib/brand-font";
import { formatMarketCardDate } from "@/lib/market-cover";
import { cacheMarketCardForDetail } from "@/lib/markets/market-card-cache";
const ORDERBOOK_ADDRESS = (deployment as unknown as { contracts: Record<string, string> }).contracts.MondaloreOrderBook as `0x${string}`;
const ORDERBOOK_ABI = parseAbi([
  "function placeSellOrder(address market, address token, uint256 price, uint256 amount) returns (bytes32)",
  "function placeBuyOrder(address market, address token, uint256 price, uint256 amount) payable returns (bytes32)",
]);
const MARKET_ABI = parseAbi([
  "function marketKind() view returns (uint8)",
  "function metadataURI() view returns (string)",
  "function stakeEndTimestamp() view returns (uint256)",
  "function resolveAfterTimestamp() view returns (uint256)",
  "function numOutcomes() view returns (uint8)",
  "function state() view returns (uint8)",
  "function collateralDecimals() view returns (uint8)",
  "function realPool(uint256 outcomeIndex) view returns (uint256)",
  "function priceOf(uint8 outcomeIndex) view returns (uint256)",
  "function deposit(uint8 outcomeIndex, uint256 amount, address recipient, uint256 minSharesOut) payable",
  "function collateralAddress() view returns (address)",
  "function priceBinLower(uint256) view returns (uint256)",
  "function priceBinUpper(uint256) view returns (uint256)",
  "function outcomeToken(uint256) view returns (address)",
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
  /** Sum of `realPool` across outcomes — actual collateral in the market (TVL). */
  poolTvl: string;
  chancePct: number;
  collateralAddress: `0x${string}`;
  collateralDecimals: number;
  /** Formatted bin strings per outcome for price markets (Chainlink-style 8-decimal bounds). */
  priceBinByOutcome?: string[];
  /** Implied probability % per outcome (from `priceOf`, 18-dec WAD → same order as outcomeLabels). */
  outcomeChancePcts: number[];
  slug?: string;
  categories?: string[];
};

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

function formatMoneyAmount(unformatted: string, ticker: string): string {
  const n = Number(unformatted);
  if (!Number.isFinite(n)) return unformatted;
  const compact = n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (isUsdStyledCollateralTicker(ticker)) return `$${compact}`;
  return `${compact} ${ticker}`;
}

function formatTradeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("returned no data") || msg.includes("not a contract") || msg.includes(`not found on ${DEPLOYMENT_NETWORK_LABEL}`)) {
    return `Market price unavailable. Confirm you are on ${DEPLOYMENT_NETWORK_LABEL} and refresh the page.`;
  }
  if (msg.includes("User rejected") || msg.includes("user rejected")) return "Transaction cancelled.";
  return msg.length > 240 ? "Trade failed. Try again." : msg;
}

export function MarketClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const publicClient = deploymentPublicClient;
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [markets, setMarkets] = useState<UiMarket[]>([]);
  const [tvlOverrides, setTvlOverrides] = useState<Record<string, string>>({});
  const [tvlRefreshing, setTvlRefreshing] = useState<Record<string, boolean>>({});

  const refreshTvl = async (m: UiMarket) => {
    if (!publicClient || tvlRefreshing[m.address]) return;
    setTvlRefreshing((p) => ({ ...p, [m.address]: true }));
    try {
      const pools = await Promise.all(
        Array.from({ length: m.outcomes }, (_, i) =>
          publicClient.readContract({ address: m.address as `0x${string}`, abi: MARKET_ABI, functionName: "realPool", args: [BigInt(i)] }) as Promise<bigint>
        )
      );
      const total = pools.reduce((acc, v) => acc + v, BigInt(0));
      const formatted = Number(formatUnits(total, m.collateralDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
      setTvlOverrides((p) => ({ ...p, [m.address]: formatted }));
    } catch { /* ignore */ } finally {
      setTvlRefreshing((p) => ({ ...p, [m.address]: false }));
    }
  };
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedMarket, setSelectedMarket] = useState<UiMarket | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeStatus, setTradeStatus] = useState("");
  const [tradeSuccess, setTradeSuccess] = useState<TradeSuccessResult | null>(null);
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradePriceRaw, setTradePriceRaw] = useState<bigint | null>(null);
  const [collateralBalance, setCollateralBalance] = useState<bigint | null>(null);
  const [collateralAllowance, setCollateralAllowance] = useState<bigint | null>(null);
  const [tradeSlippageBps, setTradeSlippageBps] = useState(200);
  const [outcomeTokenForTrade, setOutcomeTokenForTrade] = useState<`0x${string}` | null>(null);
  const [outcomeTokenBalance, setOutcomeTokenBalance] = useState<bigint | null>(null);
  /** Bumps on an interval while the trade modal is open so expiry / stake-end disables react to wall clock. */
  const [tradeModalClock, setTradeModalClock] = useState(0);
  /** Bumps on an interval so expired markets disappear from the list without a manual refresh. */
  const [marketListClock, setMarketListClock] = useState(0);

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      setLoadError("");
      try {
        const res = await fetch("/api/markets", { cache: "no-store" });
        const json = (await res.json()) as { markets?: UiMarket[]; error?: string };
        if (!res.ok) {
          throw new Error(json.error ?? "Could not load markets.");
        }
        setMarkets(json.markets ?? []);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load markets.");
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, []);

  // Fetch outcome token address when selected market/outcome changes (needed for limit orders)
  useEffect(() => {
    if (!selectedMarket || !publicClient) { setOutcomeTokenForTrade(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const token = (await publicClient.readContract({
          address: selectedMarket.address,
          abi: MARKET_ABI,
          functionName: "outcomeToken",
          args: [BigInt(selectedOutcome)],
        })) as `0x${string}`;
        if (!cancelled) setOutcomeTokenForTrade(token);
      } catch { if (!cancelled) setOutcomeTokenForTrade(null); }
    })();
    return () => { cancelled = true; };
  }, [selectedMarket, selectedOutcome, publicClient]);

  useEffect(() => {
    if (!selectedMarket || !publicClient || !address || !outcomeTokenForTrade) {
      setOutcomeTokenBalance(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const bal = (await publicClient.readContract({
          address: outcomeTokenForTrade,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        })) as bigint;
        if (!cancelled) setOutcomeTokenBalance(bal);
      } catch {
        if (!cancelled) setOutcomeTokenBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMarket, publicClient, address, outcomeTokenForTrade, selectedOutcome, tradeBusy]);

  useEffect(() => {
    if (!selectedMarket) return;
    const id = setInterval(() => setTradeModalClock((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [selectedMarket]);

  useEffect(() => {
    const id = setInterval(() => setMarketListClock((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedMarket || !publicClient) {
      setTradePriceRaw(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const p = await readMarketPrice(selectedMarket.address, selectedOutcome, MARKET_ABI);
        if (!cancelled) setTradePriceRaw(p);
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

  const visibleMarkets = useMemo(() => {
    void marketListClock;
    const now = Math.floor(Date.now() / 1000);
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();
    const filter = (searchParams.get("filter") ?? "Trending").trim();

    let rows = markets.filter((m) => m.stakeEndUnix > now);
    if (q) {
      rows = rows.filter((m) => {
        const hay = `${m.title} ${m.description} ${m.slug ?? ""} ${(m.categories ?? []).join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const categoryFilters = new Set(["Crypto", "Politics", "Finance", "Tech", "Economy", "Sports", "Gaming"]);
    if (categoryFilters.has(filter)) {
      rows = rows.filter((m) =>
        (m.categories ?? []).some((c) => c.toLowerCase() === filter.toLowerCase()),
      );
    }

    if (filter === "Breaking") {
      rows = rows.filter((m) => m.resolveAfterUnix - now <= 24 * 60 * 60);
    }

    const tvlValue = (m: UiMarket) => {
      const v = Number((tvlOverrides[m.address] ?? m.poolTvl).replace(/,/g, ""));
      return Number.isFinite(v) ? v : 0;
    };

    if (filter === "Newest") {
      rows = [...rows].sort((a, b) => b.resolveAfterUnix - a.resolveAfterUnix);
    } else {
      // Trending/default: highest TVL first.
      rows = [...rows].sort((a, b) => tvlValue(b) - tvlValue(a));
    }

    return rows;
  }, [markets, marketListClock, searchParams, tvlOverrides]);

  const empty = useMemo(
    () => !isLoading && !loadError && visibleMarkets.length === 0,
    [isLoading, loadError, visibleMarkets.length],
  );

  const tradeSummary = useMemo(() => {
    if (!selectedMarket || !tradePriceRaw || tradePriceRaw === BigInt(0)) return null;
    const t = tradeAmount.trim();
    if (!t || !Number.isFinite(Number(t)) || Number(t) <= 0) return null;
    try {
      const amountWei = parseUnits(t, selectedMarket.collateralDecimals);
      // Deduct 1.5% fee (0.3% creator + 1.2% protocol) before computing shares
      // to match what the contract actually mints.
      const creatorFee = (amountWei * BigInt(30)) / BigInt(10000);
      const protocolFee = (amountWei * BigInt(120)) / BigInt(10000);
      const netAmount = amountWei - creatorFee - protocolFee;
      const sharesWei = (netAmount * WAD) / tradePriceRaw;
      if (sharesWei === BigInt(0)) return null;
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
    if (!tradeSummary || tradeSummary.sharesWei === BigInt(0)) return null;
    const raw = (tradeSummary.amountWei * WAD) / tradeSummary.sharesWei;
    const s = formatUnits(raw, 18);
    const ticker = selectedMarket ? collateralTickerFromDeployment(selectedMarket.collateralAddress) : "TOKEN";
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
    const tick = collateralTickerFromDeployment(selectedMarket.collateralAddress);
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

  const submitLimitOrderFromParams = async (params: LimitOrderParams) => {
    if (!selectedMarket || !publicClient || !walletClient || !address) throw new Error("Connect wallet first.");
    if (chainId !== DEPLOYMENT_CHAIN_ID) throw new Error(wrongNetworkMessage());
    if (!outcomeTokenForTrade) throw new Error("Fetching token address — try again.");
    const priceNum = Number(params.price);
    const amountNum = Number(params.amount);
    if (!Number.isFinite(priceNum) || priceNum <= 0) throw new Error("Enter a valid price.");
    if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error("Enter a valid amount.");
    const dec = selectedMarket.collateralDecimals;
    const priceUnits = parseUnits(params.price, dec);
    const amountUnits = parseUnits(params.amount, dec);
    if (params.side === "sell") {
      const allowance = (await publicClient.readContract({
        address: outcomeTokenForTrade, abi: ERC20_ABI, functionName: "allowance", args: [address, ORDERBOOK_ADDRESS],
      })) as bigint;
      if (allowance < amountUnits) {
        const h = await walletClient.writeContract({
          chain: walletClient.chain, address: outcomeTokenForTrade, abi: ERC20_ABI,
          functionName: "approve", args: [ORDERBOOK_ADDRESS, amountUnits], account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      const tx = await walletClient.writeContract({
        chain: walletClient.chain, address: ORDERBOOK_ADDRESS, abi: ORDERBOOK_ABI,
        functionName: "placeSellOrder", args: [selectedMarket.address, outcomeTokenForTrade, priceUnits, amountUnits], account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    } else {
      const notional = (amountUnits * priceUnits) / BigInt(10 ** dec);
      const escrow = notional + (notional * BigInt(50)) / BigInt(10000);
      const allowance = (await publicClient.readContract({
        address: selectedMarket.collateralAddress, abi: ERC20_ABI, functionName: "allowance", args: [address, ORDERBOOK_ADDRESS],
      })) as bigint;
      if (allowance < escrow) {
        const h = await walletClient.writeContract({
          chain: walletClient.chain, address: selectedMarket.collateralAddress, abi: ERC20_ABI,
          functionName: "approve", args: [ORDERBOOK_ADDRESS, escrow], account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      const tx = await walletClient.writeContract({
        chain: walletClient.chain, address: ORDERBOOK_ADDRESS, abi: ORDERBOOK_ABI,
        functionName: "placeBuyOrder", args: [selectedMarket.address, outcomeTokenForTrade, priceUnits, amountUnits], account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    }
  };

  const openTrade = (market: UiMarket, outcomeIndex: number) => {
    setSelectedMarket(market);
    setSelectedOutcome(outcomeIndex);
    setTradeAmount("");
    setTradeStatus("");
    setTradeSuccess(null);
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
      setTradeStatus(wrongNetworkMessage());
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
      const currentPrice = tradePriceRaw;
      if (!currentPrice || currentPrice <= BigInt(0)) {
        setTradeStatus("Market price unavailable. Refresh and try again.");
        return;
      }
      // Use net amount (after 1.5% fee) for slippage baseline so minSharesOut
      // matches what the contract will actually mint.
      const creatorFeeEst = (amountUnits * BigInt(30)) / BigInt(10000);
      const protocolFeeEst = (amountUnits * BigInt(120)) / BigInt(10000);
      const netAmountEst = amountUnits - creatorFeeEst - protocolFeeEst;
      const estSharesNet = (netAmountEst * WAD) / currentPrice;
      const slipBps = Math.min(5000, Math.max(1, tradeSlippageBps));
      const minSharesOut = (estSharesNet * BigInt(10_000 - slipBps)) / BigInt(10000);

      const isNative = selectedMarket.collateralAddress.toLowerCase() === zeroAddress;
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
        gas: BigInt(500_000),
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      const tick = collateralTickerFromDeployment(selectedMarket.collateralAddress);
      const spendLabel = isUsdStyledCollateralTicker(tick)
        ? `$${tradeAmount} ${tick}`
        : `${tradeAmount} ${tick}`;
      setTradeSuccess({
        outcomeLabel: selectedMarket.outcomeLabels[selectedOutcome] ?? `Outcome ${selectedOutcome + 1}`,
        amountLabel: spendLabel,
        sharesLabel: tradeSummary?.tokens ?? "—",
        txHash,
      });
      setTradeStatus("");
      setTradeAmount("");
    } catch (error) {
      setTradeStatus(formatTradeError(error));
    } finally {
      setTradeBusy(false);
    }
  };

  return (
    <AppLayout showFilterStrip searchPlaceholder="Search markets... (Ctrl/Cmd + K)">
      <section className="mx-4 pt-8 md:mx-6">
        <div className="mb-2 flex items-center gap-2">
          <TrendUp size={22} weight="bold" className="text-[var(--accent)]" />
          <h1 className={`text-xl tracking-tight md:text-2xl ${brandPageTitle}`}>Markets</h1>
        </div>
        {isLoading && (
          <div className="mt-5 grid w-full max-w-7xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <MarketListCardSkeleton key={i} />
            ))}
          </div>
        )}
        {loadError && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="max-w-md text-center text-sm leading-relaxed text-red-400">{loadError}</p>
          </div>
        )}
        {empty && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-sm text-[var(--muted)]">No markets yet.</p>
          </div>
        )}
        {!isLoading && visibleMarkets.length > 0 && (
          <div className="mt-5 grid w-full max-w-7xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleMarkets.map((m) => (
              <MarketListCard
                key={m.address}
                title={m.title}
                imageUrl={m.imageUrl}
                outcomeLabels={m.outcomeLabels ?? []}
                outcomeChancePcts={m.outcomeChancePcts}
                poolTvl={tvlOverrides[m.address] ?? m.poolTvl}
                resolveAfter={formatMarketCardDate(m.resolveAfterUnix * 1000) ?? m.resolveAfter}
                showNewBadge={
                  (() => {
                    const v = Number((tvlOverrides[m.address] ?? m.poolTvl).replace(/,/g, ""));
                    return !Number.isFinite(v) || v <= 0;
                  })()
                }
                onTitleClick={() => {
                  cacheMarketCardForDetail(m.address, {
                    title: m.title,
                    description: m.description,
                    imageUrl: m.imageUrl,
                    slug: m.slug,
                    outcomeLabels: m.outcomeLabels,
                    categories: m.categories,
                  });
                  router.push(`/market/${m.address}`);
                }}
                onTrade={(idx) => openTrade(m, idx)}
                onRefreshTvl={() => void refreshTvl(m)}
                tvlRefreshing={Boolean(tvlRefreshing[m.address])}
              />
            ))}
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
        presentation="sheet"
        open={Boolean(selectedMarket)}
        onClose={() => {
          setSelectedMarket(null);
          setTradeStatus("");
          setTradeSuccess(null);
          setTradeAmount("");
        setOutcomeTokenBalance(null);
        }}
        marketTitle={selectedMarket?.title ?? "Trade"}
        priceRangeLine={selectedMarket?.priceBinByOutcome?.[selectedOutcome] ?? null}
        stakeEnds={selectedMarket?.stakeEnds ?? "—"}
        resolveAfter={selectedMarket?.resolveAfter ?? "—"}
        outcomeLabels={selectedMarket?.outcomeLabels ?? []}
        selectedOutcomeIndex={selectedOutcome}
        onSelectOutcome={setSelectedOutcome}
        outcomeChancePcts={selectedMarket?.outcomeChancePcts}
        hideOutcomeSelector={(selectedMarket?.outcomeLabels.length ?? 0) > 2}
        isWalletConnected={Boolean(address)}
        collateralDecimals={selectedMarket?.collateralDecimals ?? 6}
        collateralTicker={selectedMarket ? collateralTickerFromDeployment(selectedMarket.collateralAddress) : "TOKEN"}
        amount={tradeAmount}
        setAmount={setTradeAmount}
        priceOfRaw={tradePriceRaw}
        walletBalanceWei={collateralBalance}
        outcomeTokenBalanceWei={outcomeTokenBalance}
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
        onSubmitLimit={submitLimitOrderFromParams}
        tradeSuccess={tradeSuccess}
        onDismissSuccess={() => {
          setTradeSuccess(null);
          setSelectedMarket(null);
          setTradeAmount("");
          setOutcomeTokenBalance(null);
        }}
      />
    </AppLayout>
  );
}

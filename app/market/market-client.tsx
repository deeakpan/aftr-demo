"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatUnits, parseAbi, parseUnits, zeroAddress } from "viem";
import { useSessionWallet } from "@/lib/session-wallet";
import { hasWalletConnectProjectId } from "@/app/wagmi-config";
import { AppLayout } from "@/app/components/app-layout";
import { MarketListCard, MarketListCardSkeleton, MARKET_CARD_GRID_CLASS } from "@/app/market/components/market-list-card";
import { NadMarketListCard } from "@/app/market/components/nad-market-list-card";
import type { NadMarketConfig } from "@/lib/nad/types";
import { LimitOrderParams, TradeModal, type TradeSuccessResult } from "@/app/market/components/trade-modal";
import {
  collateralTickerFromDeployment,
  isUsdStyledCollateralTicker,
} from "@/lib/deployment-collateral";
import { deploymentPublicClient, readMarketPrice } from "@/lib/deployment-public-client";
import deployment, { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL, wrongNetworkMessage } from "@/lib/deployment";
import { formatMarketCardDate, formatMarketClosesTooltip } from "@/lib/market-cover";
import { cacheMarketCardForDetail } from "@/lib/markets/market-card-cache";
import { searchMarkets } from "@/lib/markets/market-search";
import { marketPath } from "@/lib/markets/market-url";
import { formatUserTxError } from "@/lib/tx-error";
import { tradeFeesFromAmount } from "@/lib/trade-fees";
import { applySlippageMaxIn, applySlippageMinOut, estimateFpmmBuyTokensOut, estimateFpmmSellTokensIn, estimateMaxFpmmSellReturn } from "@/lib/fpmm-trade";
import { isFpmmMarket } from "@/lib/market-mechanism";
import {
  MARKET_READ_ABI,
  marketBuyCall,
  marketSellCall,
  readMarketPoolTotal,
} from "@/lib/market-abi";
import {
  DEFAULT_SLIPPAGE_BPS,
  clampSlippageBps,
  readDefaultSlippageBps,
  writeDefaultSlippageBps,
} from "@/lib/trade-slippage";
const ORDERBOOK_ADDRESS = (deployment as unknown as { contracts: Record<string, string> }).contracts.MondaloreOrderBook as `0x${string}`;
const ORDERBOOK_ABI = parseAbi([
  "function placeSellOrder(address market, address token, uint256 price, uint256 amount) returns (bytes32)",
  "function placeBuyOrder(address market, address token, uint256 price, uint256 amount) payable returns (bytes32)",
]);
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

const WAD = BigInt("1000000000000000000");

type UiMarket = {
  address: `0x${string}`;
  kind: "Event" | "Price" | "Nad";
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
  nadMarket?: NadMarketConfig;
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
  if (/StakePeriodEnded|0x9622d9cf|trading closed|stake (period )?end/i.test(msg)) {
    return "Trading has closed for this market.";
  }
  if (/Slippage|0x7dd37f70/i.test(msg)) {
    return "Price moved too much. Increase slippage or try a smaller size.";
  }
  if (msg.includes("returned no data") || msg.includes("not a contract") || msg.includes(`not found on ${DEPLOYMENT_NETWORK_LABEL}`)) {
    return `Market price unavailable. Confirm you are on ${DEPLOYMENT_NETWORK_LABEL} and refresh the page.`;
  }
  return formatUserTxError(error, "Trade failed. Try again.");
}

export function MarketClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const publicClient = deploymentPublicClient;
  const { address, chainId, writeContract } = useSessionWallet();
  const [markets, setMarkets] = useState<UiMarket[]>([]);
  const [tvlOverrides, setTvlOverrides] = useState<Record<string, string>>({});
  const [tvlRefreshing, setTvlRefreshing] = useState<Record<string, boolean>>({});

  const refreshTvl = async (m: UiMarket) => {
    if (!publicClient || tvlRefreshing[m.address]) return;
    setTvlRefreshing((p) => ({ ...p, [m.address]: true }));
    try {
      const isFpmm = await isFpmmMarket(publicClient, m.address);
      const total = await readMarketPoolTotal(publicClient, m.address, m.outcomes, isFpmm);
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
  const [tradeSlippageBps, setTradeSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [outcomeTokenForTrade, setOutcomeTokenForTrade] = useState<`0x${string}` | null>(null);
  const [outcomeTokenBalance, setOutcomeTokenBalance] = useState<bigint | null>(null);
  const [outcomeTokenAllowance, setOutcomeTokenAllowance] = useState<bigint | null>(null);
  const [selectedMarketIsFpmm, setSelectedMarketIsFpmm] = useState(false);
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
        const json = (await res.json()) as { markets?: UiMarket[]; error?: string; notice?: string };
        if (!res.ok) {
          throw new Error(json.error ?? "Could not load markets.");
        }
        setMarkets(json.markets ?? []);
        if (json.notice) setLoadError(json.notice);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load markets.");
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, []);

  useEffect(() => {
    if (!selectedMarket || !publicClient) {
      setSelectedMarketIsFpmm(false);
      return;
    }
    let cancelled = false;
    void isFpmmMarket(publicClient, selectedMarket.address).then((fpmm) => {
      if (!cancelled) setSelectedMarketIsFpmm(fpmm);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedMarket, publicClient]);

  // Fetch outcome token address when selected market/outcome changes (needed for limit orders)
  useEffect(() => {
    if (!selectedMarket || !publicClient) { setOutcomeTokenForTrade(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const token = (await publicClient.readContract({
          address: selectedMarket.address,
          abi: MARKET_READ_ABI,
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
      setOutcomeTokenAllowance(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [bal, allowance] = await Promise.all([
          publicClient.readContract({
            address: outcomeTokenForTrade,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: outcomeTokenForTrade,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, selectedMarket.address],
          }) as Promise<bigint>,
        ]);
        if (!cancelled) {
          setOutcomeTokenBalance(bal);
          setOutcomeTokenAllowance(allowance);
        }
      } catch {
        if (!cancelled) {
          setOutcomeTokenBalance(null);
          setOutcomeTokenAllowance(null);
        }
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
        const p = await readMarketPrice(selectedMarket.address, selectedOutcome, MARKET_READ_ABI);
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
      rows = searchMarkets(rows, q, { limit: 999 }).map((hit) => hit.market);
    }

    const categoryFilters = new Set([
      "Crypto",
      "Politics",
      "Finance",
      "Tech",
      "Economy",
      "Sports",
      "Gaming",
      "Entertainment",
    ]);
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
      if (tradeSide === "sell") {
        // Display estimate; exact tokens-in computed on submit via FPMM math.
        const sharesWei = (amountWei * WAD) / tradePriceRaw;
        if (sharesWei === BigInt(0)) return null;
        return {
          spend: formatUnits(amountWei, selectedMarket.collateralDecimals),
          tokens: formatUnits(sharesWei, selectedMarket.collateralDecimals),
          amountWei,
          sharesWei,
        };
      }
      const { netAmount } = tradeFeesFromAmount(amountWei);
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
  }, [selectedMarket, tradePriceRaw, tradeAmount, tradeSide]);

  const pricePerTokenLabel = useMemo(() => {
    if (!tradeSummary || tradeSummary.sharesWei === BigInt(0)) return null;
    const raw = (tradeSummary.amountWei * WAD) / tradeSummary.sharesWei;
    const s = formatUnits(raw, 18);
    const ticker = selectedMarket ? collateralTickerFromDeployment(selectedMarket.collateralAddress) : "TOKEN";
    return formatMoneyAmount(s, ticker);
  }, [tradeSummary, selectedMarket?.collateralAddress]);

  useEffect(() => {
    setTradeSlippageBps(readDefaultSlippageBps());
  }, []);

  const setTradeSlippageDefault = (bps: number) => {
    const next = clampSlippageBps(bps);
    setTradeSlippageBps(next);
    writeDefaultSlippageBps(next);
  };

  const isNativeCollateral = Boolean(
    selectedMarket?.collateralAddress?.toLowerCase() === zeroAddress,
  );

  const tradeDisabled = useMemo(() => {
    void tradeModalClock;
    if (!selectedMarket) return false;
    const now = Math.floor(Date.now() / 1000);
    if (selectedMarket.marketState !== 0) return true;
    if (now >= selectedMarket.resolveAfterUnix) return true;
    // Buy closes at stake end; sell stays open until resolve.
    if (tradeSide === "buy" && now >= selectedMarket.stakeEndUnix) return true;
    if (selectedMarketIsFpmm && selectedMarket.collateralAddress.toLowerCase() === zeroAddress) return true;
    if (tradeSide === "sell" && !selectedMarketIsFpmm) return true;
    return false;
  }, [selectedMarket, selectedMarketIsFpmm, tradeModalClock, tradeSide]);

  const submitLimitOrderFromParams = async (params: LimitOrderParams) => {
    if (!selectedMarket || !publicClient || !address) throw new Error("Connect wallet first.");
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
        const h = await writeContract({
          address: outcomeTokenForTrade, abi: ERC20_ABI,
          functionName: "approve", args: [ORDERBOOK_ADDRESS, amountUnits], account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      const tx = await writeContract({
        address: ORDERBOOK_ADDRESS, abi: ORDERBOOK_ABI,
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
        const h = await writeContract({
          address: selectedMarket.collateralAddress, abi: ERC20_ABI,
          functionName: "approve", args: [ORDERBOOK_ADDRESS, escrow], account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      const tx = await writeContract({
        address: ORDERBOOK_ADDRESS, abi: ORDERBOOK_ABI,
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
    setTradeSide("buy");
  };

  const fillMaxSell = async () => {
    if (!selectedMarket || !publicClient || outcomeTokenBalance == null || outcomeTokenBalance <= BigInt(0)) {
      return;
    }
    try {
      const maxReturn = await estimateMaxFpmmSellReturn(
        publicClient,
        selectedMarket.address,
        selectedOutcome,
        outcomeTokenBalance,
      );
      if (maxReturn <= BigInt(0)) {
        setTradeStatus("No sellable size for this pool.");
        return;
      }
      setTradeAmount(formatUnits(maxReturn, selectedMarket.collateralDecimals));
    } catch (error) {
      setTradeStatus(formatTradeError(error));
    }
  };

  const submitTrade = async (side: "buy" | "sell" = "buy") => {
    if (!selectedMarket || !publicClient || !address) {
      setTradeStatus("Connect wallet first.");
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    if (selectedMarket.marketState !== 0) {
      setTradeStatus(`Market is ${selectedMarket.stateLabel.toLowerCase()}.`);
      return;
    }
    if (now >= selectedMarket.resolveAfterUnix) {
      setTradeStatus("Trading closed for this market.");
      return;
    }
    if (side === "buy" && now >= selectedMarket.stakeEndUnix) {
      setTradeStatus("Trading closed for this market.");
      return;
    }
    if (side === "sell" && !selectedMarketIsFpmm) {
      setTradeStatus("Market sell is only available on FPMM markets.");
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
      setTradeStatus("");
      const amountUnits = parseUnits(tradeAmount, selectedMarket.collateralDecimals);
      const currentPrice = tradePriceRaw;
      if (!currentPrice || currentPrice <= BigInt(0)) {
        setTradeStatus("Market price unavailable. Refresh and try again.");
        return;
      }

      if (side === "sell") {
        if (!outcomeTokenForTrade) {
          setTradeStatus("Fetching share token — try again.");
          return;
        }
        const tokensIn = await estimateFpmmSellTokensIn(
          publicClient,
          selectedMarket.address,
          selectedOutcome,
          amountUnits,
        );
        if (tokensIn <= BigInt(0)) {
          setTradeStatus("Trade size too small for this pool.");
          return;
        }
        if (outcomeTokenBalance != null && tokensIn > outcomeTokenBalance) {
          setTradeStatus("Insufficient shares for this sell size.");
          return;
        }
        const maxOutcomeTokens = applySlippageMaxIn(tokensIn, tradeSlippageBps);
        const allowance = (await publicClient.readContract({
          address: outcomeTokenForTrade,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, selectedMarket.address],
        })) as bigint;
        if (allowance < maxOutcomeTokens) {
          const approveHash = await writeContract({
            address: outcomeTokenForTrade,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [selectedMarket.address, maxOutcomeTokens],
            account: address,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        const sellCall = marketSellCall({
          outcomeIndex: selectedOutcome,
          returnAmount: amountUnits,
          maxOutcomeTokens,
        });
        const txHash = await writeContract({
          address: selectedMarket.address,
          abi: sellCall.abi,
          functionName: sellCall.functionName,
          args: sellCall.args as never,
          account: address,
          gas: BigInt(500_000),
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        const tick = collateralTickerFromDeployment(selectedMarket.collateralAddress);
        const receiveLabel = isUsdStyledCollateralTicker(tick)
          ? `$${tradeAmount} ${tick}`
          : `${tradeAmount} ${tick}`;
        setTradeSuccess({
          outcomeLabel: selectedMarket.outcomeLabels[selectedOutcome] ?? `Outcome ${selectedOutcome + 1}`,
          amountLabel: receiveLabel,
          sharesLabel: formatUnits(tokensIn, selectedMarket.collateralDecimals),
          txHash,
          side: "sell",
        });
        setTradeStatus("");
        setTradeAmount("");
        return;
      }

      let minSharesOut: bigint;
      if (selectedMarketIsFpmm) {
        const expectedOut = await estimateFpmmBuyTokensOut(
          publicClient,
          selectedMarket.address,
          selectedOutcome,
          amountUnits,
        );
        if (expectedOut <= BigInt(0)) {
          setTradeStatus("Trade size too small for this pool.");
          return;
        }
        minSharesOut = applySlippageMinOut(expectedOut, tradeSlippageBps);
      } else {
        const { netAmount: netAmountEst } = tradeFeesFromAmount(amountUnits);
        const estSharesNet = (netAmountEst * WAD) / currentPrice;
        minSharesOut = applySlippageMinOut(estSharesNet, tradeSlippageBps);
      }

      const isNative = selectedMarket.collateralAddress.toLowerCase() === zeroAddress;
      if (!isNative) {
        const allowance = (await publicClient.readContract({
          address: selectedMarket.collateralAddress,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, selectedMarket.address],
        })) as bigint;
        if (allowance < amountUnits) {
          const approveHash = await writeContract({
            address: selectedMarket.collateralAddress,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [selectedMarket.address, amountUnits],
            account: address,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      if (Math.floor(Date.now() / 1000) >= selectedMarket.stakeEndUnix) {
        setTradeStatus("Trading has closed for this market.");
        return;
      }

      const buyCall = marketBuyCall(selectedMarketIsFpmm, {
        outcomeIndex: selectedOutcome,
        amountUnits,
        recipient: address,
        minSharesOut,
      });
      const txHash = await writeContract({
        address: selectedMarket.address,
        abi: buyCall.abi,
        functionName: buyCall.functionName,
        args: buyCall.args as never,
        account: address,
        value: !selectedMarketIsFpmm && isNative ? amountUnits : undefined,
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
        side: "buy",
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
      <section className="mx-4 pt-2 md:mx-6">
        {isLoading && (
          <div className={MARKET_CARD_GRID_CLASS}>
            {Array.from({ length: 6 }, (_, i) => (
              <MarketListCardSkeleton key={i} />
            ))}
          </div>
        )}
        {loadError && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="max-w-lg text-center text-sm leading-relaxed text-[var(--muted)]">{loadError}</p>
          </div>
        )}
        {empty && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-sm text-[var(--muted)]">No markets yet.</p>
          </div>
        )}
        {!isLoading && visibleMarkets.length > 0 && (
          <div className={MARKET_CARD_GRID_CLASS}>
            {visibleMarkets.map((m) =>
              m.nadMarket ? (
                <NadMarketListCard
                  key={m.address}
                  title={m.title}
                  nadMarket={m.nadMarket}
                  outcomeLabels={m.outcomeLabels ?? []}
                  outcomeChancePcts={m.outcomeChancePcts}
                  poolTvl={tvlOverrides[m.address] ?? m.poolTvl}
                  resolveAfter={formatMarketCardDate(m.resolveAfterUnix * 1000) ?? "—"}
                  resolveAfterTooltip={formatMarketClosesTooltip(m.resolveAfterUnix * 1000)}
                  marketAddress={m.address}
                  slug={m.slug}
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
                    router.push(marketPath({ slug: m.slug, address: m.address }));
                  }}
                  onTrade={(idx) => openTrade(m, idx)}
                  onRefreshTvl={() => void refreshTvl(m)}
                  tvlRefreshing={Boolean(tvlRefreshing[m.address])}
                  tradingClosed={
                    m.marketState !== 0 ||
                    Math.floor(Date.now() / 1000) >= m.stakeEndUnix
                  }
                />
              ) : (
              <MarketListCard
                key={m.address}
                title={m.title}
                imageUrl={m.imageUrl}
                outcomeLabels={m.outcomeLabels ?? []}
                outcomeChancePcts={m.outcomeChancePcts}
                poolTvl={tvlOverrides[m.address] ?? m.poolTvl}
                resolveAfter={formatMarketCardDate(m.resolveAfterUnix * 1000) ?? "—"}
                resolveAfterTooltip={formatMarketClosesTooltip(m.resolveAfterUnix * 1000)}
                marketAddress={m.address}
                slug={m.slug}
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
                  router.push(marketPath({ slug: m.slug, address: m.address }));
                }}
                onTrade={(idx) => openTrade(m, idx)}
                onRefreshTvl={() => void refreshTvl(m)}
                tvlRefreshing={Boolean(tvlRefreshing[m.address])}
                tradingClosed={
                  m.marketState !== 0 ||
                  Math.floor(Date.now() / 1000) >= m.stakeEndUnix
                }
              />
              ),
            )}
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
          setTradeSide("buy");
        setOutcomeTokenBalance(null);
        }}
        marketTitle={selectedMarket?.title ?? "Trade"}
        priceRangeLine={selectedMarket?.priceBinByOutcome?.[selectedOutcome] ?? null}
        stakeEnds={selectedMarket?.stakeEnds ?? "—"}
        resolveAfter={
          selectedMarket
            ? (formatMarketCardDate(selectedMarket.resolveAfterUnix * 1000) ?? "—")
            : "—"
        }
        resolveAfterTooltip={
          selectedMarket
            ? formatMarketClosesTooltip(selectedMarket.resolveAfterUnix * 1000)
            : undefined
        }
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
        collateralFormatted={tradeSummary?.spend ?? null}
        pricePerTokenLabel={pricePerTokenLabel}
        slippageBps={tradeSlippageBps}
        onSlippageBpsChange={setTradeSlippageDefault}
        isNativeCollateral={isNativeCollateral}
        tradeDisabled={tradeDisabled}
        status={tradeStatus}
        busy={tradeBusy}
        marketSellEnabled={selectedMarketIsFpmm}
        marketSide={tradeSide}
        onMarketSideChange={setTradeSide}
        onFillMaxSell={() => void fillMaxSell()}
        onSubmit={(side) => {
          void submitTrade(side);
        }}
        onSubmitLimit={submitLimitOrderFromParams}
        tradeSuccess={tradeSuccess}
        onDismissSuccess={() => {
          setTradeSuccess(null);
          setSelectedMarket(null);
          setTradeAmount("");
          setTradeSide("buy");
          setOutcomeTokenBalance(null);
        }}
      />
    </AppLayout>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react";
import {
  formatUnits,
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
  zeroAddress,
} from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import { useSidebarOpen } from "@/app/components/sidebar-context";
import { MarketChartPanel } from "@/app/market/components/market-chart-panel";
import { MultiOutcomeMarketSection } from "@/app/market/components/multi-outcome-market-section";
import { LimitOrderParams, TradeModal, type TradeSuccessResult } from "@/app/market/components/trade-modal";
import { hasWalletConnectProjectId } from "@/app/wagmi-config";
import { collateralTickerFromDeployment, isUsdStyledCollateralTicker } from "@/lib/deployment-collateral";
import { deploymentPublicClient, readMarketPrice } from "@/lib/deployment-public-client";
import {
  mergeListItemIntoDetail,
  parseMarketDetailDto,
  type MarketDetailDto,
  type MarketDetailItem,
  type MarketListItem,
} from "@/lib/markets/load-markets";
import {
  fetchIpfsMetadataClient,
  isWeakMarketMetadata,
  metadataImageUrl,
  metadataOutcomeLabels,
  metadataTitle,
} from "@/lib/markets/fetch-metadata-client";
import {
  cacheMarketCardForDetail,
  readCachedMarketCard,
  type CachedMarketCard,
} from "@/lib/markets/market-card-cache";
import { MARKET_COVER_ASPECT_CLASS } from "@/lib/market-cover";
import deployment, { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL, wrongNetworkMessage } from "@/lib/deployment";
const WAD = BigInt("1000000000000000000");
const SLIPPAGE_PRESETS = [50, 100, 200, 300] as const;

const ORDERBOOK_ADDRESS = (deployment as unknown as { contracts: Record<string, string> }).contracts
  .MondaloreOrderBook as `0x${string}`;

const ORDERBOOK_ABI = parseAbi([
  "function placeSellOrder(address market, address token, uint256 price, uint256 amount) returns (bytes32)",
  "function placeBuyOrder(address market, address token, uint256 price, uint256 amount) payable returns (bytes32)",
  "function getOrderBookSnapshot(address market, address token) view returns (uint256[] bidPrices, uint256[] bidVolumes, uint256[] askPrices, uint256[] askVolumes)",
  "function getUserSellOrders(address market, address token, address user) view returns ((bytes32 _orderId, uint256 _price, uint256 _volume)[])",
  "function getUserBuyOrders(address market, address token, address user) view returns ((bytes32 _orderId, uint256 _price, uint256 _volume)[])",
]);

type ObSnapshot = {
  bidPrices: bigint[];
  bidVolumes: bigint[];
  askPrices: bigint[];
  askVolumes: bigint[];
};

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
  "function chainlinkFeed() view returns (address)",
  "function priceThreshold() view returns (uint256)",
  "function priceThresholdKind() view returns (uint8)",
  "function priceUpperBound() view returns (uint256)",
  "function winningOutcomeIndex() view returns (uint256)",
  "function settledOraclePrice() view returns (int256)",
  "function settlementTimestamp() view returns (uint256)",
  "function redemptionRate() view returns (uint256)",
  "function outcomeToken(uint256) view returns (address)",
  "function redeem(uint8 outcomeIndex, uint256 shareAmount)",
]);
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

function fmtTsFromUnix(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

function formatMoneyAmount(unformatted: string, ticker: string): string {
  const n = Number(unformatted);
  if (!Number.isFinite(n)) return unformatted;
  const compact = n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (isUsdStyledCollateralTicker(ticker)) return `$${compact}`;
  return `${compact} ${ticker}`;
}

function priceKindName(kind: number): string {
  if (kind === 0) return "Above threshold";
  if (kind === 1) return "Below threshold";
  if (kind === 2) return "In range";
  return `Kind ${kind}`;
}

function formatLoadError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("returned no data") || msg.includes("not a contract") || msg.includes("not found")) {
    return `Market not found on ${DEPLOYMENT_NETWORK_LABEL}. Check the address or try again in a moment.`;
  }
  if (msg.includes("15/sec") || msg.includes("rate limit") || msg.includes("too many")) {
    return "Network busy — refresh in a moment.";
  }
  return msg.length > 280 ? "Could not load market." : msg;
}

function formatTradeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("returned no data") || msg.includes("not a contract") || msg.includes(`not found on ${DEPLOYMENT_NETWORK_LABEL}`)) {
    return `Market price unavailable. Confirm you are on ${DEPLOYMENT_NETWORK_LABEL} and refresh the page.`;
  }
  if (msg.includes("User rejected") || msg.includes("user rejected")) return "Transaction cancelled.";
  return msg.length > 240 ? "Trade failed. Try again." : msg;
}

type Props = {
  address: string;
  initialMarket?: MarketDetailDto | null;
  initialLoadError?: string | null;
};

function applyCachedCard(detail: MarketDetailItem, cached: CachedMarketCard): MarketDetailItem {
  return {
    ...detail,
    title: cached.title || detail.title,
    description: cached.description || detail.description,
    imageUrl: cached.imageUrl || detail.imageUrl,
    slug: cached.slug ?? detail.slug,
    outcomeLabels: cached.outcomeLabels?.length ? cached.outcomeLabels : detail.outcomeLabels,
    categories: cached.categories?.length ? cached.categories : detail.categories,
  };
}

function MobileOutcomeBar({
  market,
  onSelectOutcome,
}: {
  market: MarketDetailItem;
  onSelectOutcome: (index: number) => void;
}) {
  const sidebarOpen = useSidebarOpen();

  if (market.marketState !== 0 || sidebarOpen || market.outcomes !== 2) return null;

  return (
    <div className="fixed bottom-[64px] left-0 right-0 z-20 bg-[var(--background)] px-4 py-3 md:bottom-0 lg:hidden">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => onSelectOutcome(0)}
          className="flex flex-1 items-center justify-center rounded-full bg-[var(--outcome-yes)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--outcome-yes-hover)] active:scale-[0.98]"
        >
          {market.outcomeLabels[0] ?? "Yes"}{" "}
          {(market.outcomeChancePcts?.[0] ?? market.chancePct).toFixed(0)}%
        </button>
        {market.outcomes >= 2 && (
          <button
            type="button"
            onClick={() => onSelectOutcome(1)}
            className="flex flex-1 items-center justify-center rounded-full bg-[var(--outcome-no)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--outcome-no-hover)] active:scale-[0.98]"
          >
            {market.outcomeLabels[1] ?? "No"}{" "}
            {(market.outcomeChancePcts?.[1] ?? 100 - market.chancePct).toFixed(0)}%
          </button>
        )}
      </div>
    </div>
  );
}

export function MarketDetailClient({
  address: addressProp,
  initialMarket = null,
  initialLoadError = null,
}: Props) {
  const publicClient = deploymentPublicClient;
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [market, setMarket] = useState<MarketDetailItem | null>(() => {
    if (!initialMarket) return null;
    let parsed = parseMarketDetailDto(initialMarket);
    const raw = (addressProp || "").trim();
    if (raw && isAddress(raw)) {
      try {
        const cached = readCachedMarketCard(getAddress(raw));
        if (cached) parsed = applyCachedCard(parsed, cached);
      } catch {
        // ignore
      }
    }
    return parsed;
  });
  const [loadError, setLoadError] = useState(initialLoadError ?? "");
  const [isLoading, setIsLoading] = useState(!initialMarket && !initialLoadError);

  const [tradeOpen, setTradeOpen] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeStatus, setTradeStatus] = useState("");
  const [tradeSuccess, setTradeSuccess] = useState<TradeSuccessResult | null>(null);
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradePriceRaw, setTradePriceRaw] = useState<bigint | null>(null);
  const [collateralBalance, setCollateralBalance] = useState<bigint | null>(null);
  const [collateralAllowance, setCollateralAllowance] = useState<bigint | null>(null);
  const [tradeSlippageBps, setTradeSlippageBps] = useState(200);
  const [tradeModalClock, setTradeModalClock] = useState(0);

  // Limit order state (UI state is internal to TradeModal; parent only tracks refresh tick)
  const [limitRefreshTick, setLimitRefreshTick] = useState(0);
  const [outcomeTokens, setOutcomeTokens] = useState<Record<number, `0x${string}`>>({});
  const [outcomeTokenBalance, setOutcomeTokenBalance] = useState<bigint | null>(null);
  const [obSnapshot, setObSnapshot] = useState<ObSnapshot | null>(null);
  const [chartThemeKey, setChartThemeKey] = useState(() =>
    typeof document !== "undefined"
      ? (document.documentElement.getAttribute("data-theme") ?? "dark")
      : "dark",
  );
  useEffect(() => {
    const sync = () => setChartThemeKey(document.documentElement.getAttribute("data-theme") ?? "dark");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const marketAddress = useMemo(() => {
    const raw = (addressProp || "").trim();
    if (!raw || !isAddress(raw)) return null;
    try {
      return getAddress(raw) as `0x${string}`;
    } catch {
      return null;
    }
  }, [addressProp]);

  const reload = useCallback(async () => {
    if (!marketAddress) {
      setMarket(null);
      setIsLoading(false);
      return;
    }
    setIsLoading((loading) => loading || !initialMarket);
    setLoadError("");
    try {
      // Same metadata source as market grid + trade modal (`/api/markets`), plus settlement from detail.
      const [listRes, detailRes] = await Promise.all([
        fetch("/api/markets", { cache: "no-store" }),
        fetch(`/api/markets/${marketAddress}`, { cache: "no-store" }),
      ]);

      const listJson = (await listRes.json()) as { markets?: MarketListItem[] };
      const detailRaw = await detailRes.text();
      let detailJson: { market?: MarketDetailDto; error?: string };
      try {
        detailJson = detailRaw ? (JSON.parse(detailRaw) as typeof detailJson) : {};
      } catch {
        throw new Error("Could not load market.");
      }
      if (!detailRes.ok || !detailJson.market) {
        throw new Error(detailJson.error || "Could not load market.");
      }

      let next = parseMarketDetailDto(detailJson.market);
      const card = listJson.markets?.find(
        (m) => m.address.toLowerCase() === marketAddress.toLowerCase(),
      );
      if (card) {
        next = mergeListItemIntoDetail(card, next);
      }

      const cached = readCachedMarketCard(marketAddress);
      if (cached) {
        next = applyCachedCard(next, cached);
      }

      setMarket(next);
    } catch (e) {
      setLoadError(formatLoadError(e));
      setMarket((current) => current ?? null);
    } finally {
      setIsLoading(false);
    }
  }, [marketAddress, initialMarket]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Browser IPFS fetch when server/API metadata is missing (same JSON the grid uses). */
  useEffect(() => {
    if (!marketAddress || !market || !isWeakMarketMetadata(market)) return;
    let cancelled = false;
    void (async () => {
      try {
        const uri = await publicClient.readContract({
          address: marketAddress,
          abi: MARKET_ABI,
          functionName: "metadataURI",
        });
        const md = await fetchIpfsMetadataClient(String(uri));
        if (cancelled || !md) return;
        setMarket((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            title: metadataTitle(md, prev.kind),
            description: md.description?.trim() || prev.description,
            imageUrl: metadataImageUrl(md) || prev.imageUrl,
            slug: md.slug?.trim() || prev.slug,
            outcomeLabels: metadataOutcomeLabels(md, prev.outcomes),
            categories:
              md.categories
                ?.filter((x): x is string => typeof x === "string")
                .map((x) => x.trim())
                .filter(Boolean) ?? prev.categories,
          };
        });
      } catch {
        // keep API/cached values
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketAddress, market?.title, market?.imageUrl, publicClient]);

  useEffect(() => {
    if (!market) return;
    const id = setInterval(() => setTradeModalClock((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [market]);

  useEffect(() => {
    if (!market || !publicClient) {
      setTradePriceRaw(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const p = await readMarketPrice(market.address, selectedOutcome, MARKET_ABI);
        if (!cancelled) setTradePriceRaw(p);
      } catch {
        if (!cancelled) setTradePriceRaw(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [market, selectedOutcome, publicClient]);

  useEffect(() => {
    if (!market || !publicClient || !address) {
      setCollateralBalance(null);
      setCollateralAllowance(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (market.collateralAddress.toLowerCase() === zeroAddress.toLowerCase()) {
          const b = await publicClient.getBalance({ address });
          if (!cancelled) {
            setCollateralBalance(b);
            setCollateralAllowance(null);
          }
          return;
        }
        const [b, a] = await Promise.all([
          publicClient.readContract({
            address: market.collateralAddress,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: market.collateralAddress,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, market.address],
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
  }, [market, address, publicClient, tradeBusy, tradeAmount, selectedOutcome]);

  const tradeSummary = useMemo(() => {
    if (!market || !tradePriceRaw || tradePriceRaw === BigInt(0)) return null;
    const t = tradeAmount.trim();
    if (!t || !Number.isFinite(Number(t)) || Number(t) <= 0) return null;
    try {
      const amountWei = parseUnits(t, market.collateralDecimals);
      // Deduct 1.5% fee (0.3% creator + 1.2% protocol) before computing shares
      // to match what the contract actually mints.
      const creatorFee = (amountWei * BigInt(30)) / BigInt(10000);
      const protocolFee = (amountWei * BigInt(120)) / BigInt(10000);
      const netAmount = amountWei - creatorFee - protocolFee;
      const sharesWei = (netAmount * WAD) / tradePriceRaw;
      if (sharesWei === BigInt(0)) return null;
      return {
        spend: formatUnits(amountWei, market.collateralDecimals),
        tokens: formatUnits(sharesWei, market.collateralDecimals),
        amountWei,
        sharesWei,
      };
    } catch {
      return null;
    }
  }, [market, tradePriceRaw, tradeAmount]);

  const pricePerTokenLabel = useMemo(() => {
    if (!tradeSummary || tradeSummary.sharesWei === BigInt(0) || !market) return null;
    const raw = (tradeSummary.amountWei * WAD) / tradeSummary.sharesWei;
    const s = formatUnits(raw, 18);
    const ticker = collateralTickerFromDeployment(market.collateralAddress);
    return formatMoneyAmount(s, ticker);
  }, [tradeSummary, market?.collateralAddress]);

  const isNativeCollateral = Boolean(market?.collateralAddress?.toLowerCase() === zeroAddress.toLowerCase());

  const needsApproval = Boolean(
    market &&
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
    if (!market) return true;
    const now = Math.floor(Date.now() / 1000);
    if (market.marketState !== 0) return true;
    if (now >= market.resolveAfterUnix) return true;
    if (now >= market.stakeEndUnix) return true;
    return false;
  }, [market, tradeModalClock]);

  const approvalLine = useMemo(() => {
    if (!market) return "";
    const tick = collateralTickerFromDeployment(market.collateralAddress);
    if (isNativeCollateral) return "Native collateral — no token approval.";
    if (!address || !tradeSummary) return "";
    if (collateralAllowance === null) return "Loading allowance…";
    const cur = formatUnits(collateralAllowance, market.collateralDecimals);
    const req = tradeSummary.spend;
    const enough = collateralAllowance >= tradeSummary.amountWei;
    return enough
      ? `Sufficient · ${cur} ${tick} covers ${req} ${tick}`
      : `Approve first · ${cur} ${tick} allowance, need ${req} ${tick}`;
  }, [market, address, collateralAllowance, tradeSummary, isNativeCollateral]);

  const cycleSlippage = () => {
    setTradeSlippageBps((prev) => {
      const idx = SLIPPAGE_PRESETS.indexOf(prev as (typeof SLIPPAGE_PRESETS)[number]);
      const i = idx < 0 ? 0 : (idx + 1) % SLIPPAGE_PRESETS.length;
      return SLIPPAGE_PRESETS[i]!;
    });
  };

  const submitTrade = async () => {
    if (!market || !publicClient || !walletClient || !address) {
      setTradeStatus("Connect wallet first.");
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    if (market.marketState !== 0) {
      setTradeStatus(`Market is ${market.stateLabel.toLowerCase()}.`);
      return;
    }
    if (now >= market.resolveAfterUnix || now >= market.stakeEndUnix) {
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
      const amountUnits = parseUnits(tradeAmount, market.collateralDecimals);
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
      const isNative = market.collateralAddress.toLowerCase() === zeroAddress.toLowerCase();
      if (!isNative) {
        const allowance = (await publicClient.readContract({
          address: market.collateralAddress,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, market.address],
        })) as bigint;
        if (allowance < amountUnits) {
          setTradeStatus("Approve collateral...");
          const approveHash = await walletClient.writeContract({
            chain: walletClient.chain,
            address: market.collateralAddress,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [market.address, amountUnits],
            account: address,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }
      setTradeStatus("Submitting trade...");
      const txHash = await walletClient.writeContract({
        chain: walletClient.chain,
        address: market.address,
        abi: MARKET_ABI,
        functionName: "deposit",
        args: [selectedOutcome, amountUnits, address, minSharesOut],
        account: address,
        value: isNative ? amountUnits : undefined,
        gas: BigInt(500_000),
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      const tick = collateralTickerFromDeployment(market.collateralAddress);
      const spendLabel = isUsdStyledCollateralTicker(tick)
        ? `$${tradeAmount} ${tick}`
        : `${tradeAmount} ${tick}`;
      setTradeSuccess({
        outcomeLabel: market.outcomeLabels[selectedOutcome] ?? `Outcome ${selectedOutcome + 1}`,
        amountLabel: spendLabel,
        sharesLabel: tradeSummary?.tokens ?? "—",
        txHash,
      });
      setTradeStatus("");
      setTradeAmount("");
      void reload();
    } catch (error) {
      setTradeStatus(formatTradeError(error));
    } finally {
      setTradeBusy(false);
    }
  };

  // Fetch outcome token address for current selectedOutcome
  useEffect(() => {
    if (!market || !publicClient || outcomeTokens[selectedOutcome]) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = (await publicClient.readContract({
          address: market.address,
          abi: MARKET_ABI,
          functionName: "outcomeToken",
          args: [BigInt(selectedOutcome)],
        })) as `0x${string}`;
        if (!cancelled) setOutcomeTokens((prev) => ({ ...prev, [selectedOutcome]: token }));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [market, publicClient, selectedOutcome, outcomeTokens]);

  // Fetch outcome token balance (for sell orders)
  useEffect(() => {
    const token = outcomeTokens[selectedOutcome];
    if (!market || !publicClient || !address || !token) { setOutcomeTokenBalance(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const bal = (await publicClient.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        })) as bigint;
        if (!cancelled) setOutcomeTokenBalance(bal);
      } catch { if (!cancelled) setOutcomeTokenBalance(null); }
    })();
    return () => { cancelled = true; };
  }, [market, publicClient, address, selectedOutcome, outcomeTokens, limitRefreshTick]);

  // Fetch orderbook snapshot for selected outcome
  useEffect(() => {
    const token = outcomeTokens[selectedOutcome];
    if (!market || !publicClient || !token) { setObSnapshot(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const result = await publicClient.readContract({
          address: ORDERBOOK_ADDRESS,
          abi: ORDERBOOK_ABI,
          functionName: "getOrderBookSnapshot",
          args: [market.address, token],
        }) as [bigint[], bigint[], bigint[], bigint[]];
        if (!cancelled) setObSnapshot({ bidPrices: result[0], bidVolumes: result[1], askPrices: result[2], askVolumes: result[3] });
      } catch { if (!cancelled) setObSnapshot(null); }
    })();
    return () => { cancelled = true; };
  }, [market, publicClient, selectedOutcome, outcomeTokens, limitRefreshTick]);

  const submitLimitOrderFromParams = async (params: LimitOrderParams) => {
    if (!market || !publicClient || !walletClient || !address) throw new Error("Connect wallet first.");
    if (chainId !== DEPLOYMENT_CHAIN_ID) throw new Error(wrongNetworkMessage());
    const token = outcomeTokens[params.outcomeIndex];
    if (!token) throw new Error("Fetching token address — try again.");
    const priceNum = Number(params.price);
    const amountNum = Number(params.amount);
    if (!Number.isFinite(priceNum) || priceNum <= 0) throw new Error("Enter a valid price.");
    if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error("Enter a valid amount.");
    const dec = market.collateralDecimals;
    const priceUnits = parseUnits(params.price, dec);
    const amountUnits = parseUnits(params.amount, dec);
    if (params.side === "sell") {
      const allowance = (await publicClient.readContract({
        address: token, abi: ERC20_ABI, functionName: "allowance", args: [address, ORDERBOOK_ADDRESS],
      })) as bigint;
      if (allowance < amountUnits) {
        const h = await walletClient.writeContract({
          chain: walletClient.chain, address: token, abi: ERC20_ABI,
          functionName: "approve", args: [ORDERBOOK_ADDRESS, amountUnits], account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      const tx = await walletClient.writeContract({
        chain: walletClient.chain, address: ORDERBOOK_ADDRESS, abi: ORDERBOOK_ABI,
        functionName: "placeSellOrder", args: [market.address, token, priceUnits, amountUnits], account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    } else {
      const notional = (amountUnits * priceUnits) / BigInt(10 ** dec);
      const escrow = notional + (notional * BigInt(50)) / BigInt(10000);
      const allowance = (await publicClient.readContract({
        address: market.collateralAddress, abi: ERC20_ABI, functionName: "allowance", args: [address, ORDERBOOK_ADDRESS],
      })) as bigint;
      if (allowance < escrow) {
        const h = await walletClient.writeContract({
          chain: walletClient.chain, address: market.collateralAddress, abi: ERC20_ABI,
          functionName: "approve", args: [ORDERBOOK_ADDRESS, escrow], account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      const tx = await walletClient.writeContract({
        chain: walletClient.chain, address: ORDERBOOK_ADDRESS, abi: ORDERBOOK_ABI,
        functionName: "placeBuyOrder", args: [market.address, token, priceUnits, amountUnits], account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    }
    setLimitRefreshTick((n) => n + 1);
  };

  const settledPriceHuman = useMemo(() => {
    if (!market || market.marketState !== 2) return null;
    if (market.kind !== "Price") return null;
    const ans = market.settledOraclePrice;
    if (ans === BigInt(0)) return null;
    const d = market.feedDecimals;
    const neg = ans < BigInt(0);
    const abs = neg ? -ans : ans;
    return (neg ? "-" : "") + formatUnits(abs, d);
  }, [market]);

  const thresholdHuman = useMemo(() => {
    if (!market || market.kind !== "Price") return null;
    return formatUnits(market.priceThreshold, 8);
  }, [market]);

  const tvSymbol = useMemo(() => {
    if (!market || market.kind !== "Price") return null;
    const t = market.title.toUpperCase();
    if (t.includes("BTC") || t.includes("BITCOIN")) return "BINANCE:BTCUSDT";
    if (t.includes("ETH") || t.includes("ETHEREUM")) return "BINANCE:ETHUSDT";
    if (t.includes("SOL")) return "BINANCE:SOLUSDT";
    if (t.includes("LINK")) return "BINANCE:LINKUSDT";
    if (t.includes("BNB")) return "BINANCE:BNBUSDT";
    if (t.includes("AVAX")) return "BINANCE:AVAXUSDT";
    return "BINANCE:BTCUSDT";
  }, [market]);

  if (!marketAddress) {
    return (
      <AppLayout showSearch={false}>
        <div className="flex min-h-[40vh] items-center justify-center px-4">
          <div>
            <p className="text-base font-semibold text-red-400">Invalid market address</p>
            <Link href="/market" className="mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]">
              <ArrowLeft size={14} weight="bold" /> Back to markets
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showSearch={false} viewportLocked>
      {isLoading && (
        <div className="no-scrollbar h-full overflow-y-auto">
          <div className="px-4 pt-2 md:px-6">
            <div className="mb-4 h-4 w-24 animate-pulse rounded bg-[var(--border)]/50" />
            <div className={`${MARKET_COVER_ASPECT_CLASS} w-full animate-pulse rounded-2xl bg-[var(--border)]/50`} />
            <div className="mt-6 h-[400px] animate-pulse rounded-xl bg-[var(--card)]" />
          </div>
        </div>
      )}

      {loadError && (
        <p className="px-4 py-6 text-sm text-red-400 md:px-6">{loadError}</p>
      )}

      {market && (
        <div className="flex h-full min-h-0 overflow-hidden lg:flex-row">

          {/* ── Left: scrolls under app header; trade panel stays fixed ── */}
          <div className="no-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="px-4 pb-36 pt-2 md:px-6 md:pb-24 lg:pb-6">
            <Link
              href="/market"
              className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
            >
              <ArrowLeft size={14} weight="bold" /> Markets
            </Link>

            <div className="mb-5">
              <h1 className="text-xl font-bold leading-snug text-[var(--foreground)] md:text-2xl">
                {market.title}
              </h1>
              {market.slug && (
                <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">/{market.slug}</p>
              )}
            </div>

            {market.imageUrl ? (
            <div
              className={`relative isolate mb-5 w-full shrink-0 overflow-hidden rounded-2xl bg-[var(--surface)] ${MARKET_COVER_ASPECT_CLASS} min-h-[120px] md:min-h-[160px]`}
            >
                <img
                  src={market.imageUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover object-center"
                />

              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"
                aria-hidden
              />
            </div>
            ) : null}

            {/* Outcome hero — binary only */}
            {market.outcomes === 2 && (
              <>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-[var(--outcome-yes)]">
                    {market.outcomeLabels[0] ?? "Yes"}
                  </span>
                  <span className="text-sm font-semibold text-[var(--outcome-yes)] [html[data-theme=light]_&]:text-green-700">
                    ↑ {market.chancePct.toFixed(1)}%
                  </span>
                </div>
                <p className="mb-5 text-sm text-[var(--muted)]">
                  {market.chancePct.toFixed(1)}% chance
                </p>
              </>
            )}

            {market.outcomes > 2 ? (
              <MultiOutcomeMarketSection
                labels={market.outcomeLabels}
                chancePcts={market.outcomeChancePcts ?? []}
                selectedIndex={selectedOutcome}
                onSelect={(index) => {
                  setSelectedOutcome(index);
                  if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
                    setTradeOpen(true);
                    setTradeStatus("");
                    setTradeSuccess(null);
                  }
                }}
                marketAddress={market.address}
                collateralDecimals={market.collateralDecimals}
                collateralTicker={collateralTickerFromDeployment(market.collateralAddress)}
                marketState={market.marketState}
                obSnapshot={obSnapshot}
              />
            ) : (
              <MarketChartPanel
                marketKind={market.kind}
                marketAddress={market.address}
                collateralDecimals={market.collateralDecimals}
                collateralTicker={collateralTickerFromDeployment(market.collateralAddress)}
                outcomeLabels={market.outcomeLabels}
                tvSymbol={tvSymbol}
                chartThemeKey={chartThemeKey}
              />
            )}

            {/* Order book — binary markets only (multi uses tabbed panel above) */}
            {market.marketState === 0 && outcomeTokens[selectedOutcome] && market.outcomes === 2 && (
              <div className="mt-8">
                <div className="mb-3 flex items-center justify-between border-t border-[var(--border)] pt-5">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    Order Book · {market.outcomeLabels[selectedOutcome] ?? `Outcome ${selectedOutcome}`}
                  </p>
                  <div className="flex max-w-[55%] flex-wrap justify-end gap-1">
                    {market.outcomeLabels.slice(0, 2).map((label, i) => {
                        const active = selectedOutcome === i;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setSelectedOutcome(i)}
                            className={`rounded-md px-2.5 py-1 text-[10px] font-bold tracking-wide transition ${
                              active
                                ? "bg-[var(--accent)] text-white"
                                : "text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                            }`}
                          >
                            {label}
                          </button>
                        );
                    })}
                  </div>
                </div>
                {obSnapshot && (obSnapshot.bidPrices.length > 0 || obSnapshot.askPrices.length > 0) ? (
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-500">Bids</p>
                      <div className="space-y-1">
                        {[...obSnapshot.bidPrices.map((p, i) => ({ p, v: obSnapshot.bidVolumes[i]! }))]
                          .sort((a, b) => Number(b.p - a.p))
                          .slice(0, 8)
                          .map(({ p, v }, i) => (
                            <div key={i} className="flex items-center justify-between rounded-md bg-emerald-500/5 px-2.5 py-1.5">
                              <span className="font-mono font-semibold text-emerald-400">
                                ${formatUnits(p, market.collateralDecimals)}
                              </span>
                              <span className="font-mono text-[var(--muted)]">
                                {Number(formatUnits(v, market.collateralDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-500">Asks</p>
                      <div className="space-y-1">
                        {[...obSnapshot.askPrices.map((p, i) => ({ p, v: obSnapshot.askVolumes[i]! }))]
                          .sort((a, b) => Number(a.p - b.p))
                          .slice(0, 8)
                          .map(({ p, v }, i) => (
                            <div key={i} className="flex items-center justify-between rounded-md bg-rose-500/5 px-2.5 py-1.5">
                              <span className="font-mono font-semibold text-rose-400">
                                ${formatUnits(p, market.collateralDecimals)}
                              </span>
                              <span className="font-mono text-[var(--muted)]">
                                {Number(formatUnits(v, market.collateralDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted)]">No open orders for this outcome yet.</p>
                )}
              </div>
            )}

            {/* Settlement */}
            {market.marketState === 2 && (
              <div className="mt-8">
                <div className="mb-3 border-t border-[var(--border)] pt-5">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Settlement</p>
                </div>
                <div className="space-y-px text-sm">
                  {[
                    { label: "Resolved at",    value: fmtTsFromUnix(market.settlementTimestamp) },
                    { label: "Winning outcome", value: market.winningOutcomeIndex != null
                        ? (market.outcomeLabels[market.winningOutcomeIndex] ?? `Outcome ${market.winningOutcomeIndex + 1}`)
                        : "—",
                      valueClass: "font-semibold text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300" },
                    ...(market.kind === "Price" && settledPriceHuman != null
                      ? [{ label: "Oracle price", value: `$${Number(settledPriceHuman).toLocaleString(undefined, { maximumFractionDigits: 6 })}`, mono: true }]
                      : []),
                    ...(market.kind === "Price" && !market.usesBins && thresholdHuman
                      ? [
                          { label: "Rule",      value: priceKindName(market.priceThresholdKind) },
                          { label: "Threshold", value: `$${Number(thresholdHuman).toLocaleString(undefined, { maximumFractionDigits: 6 })}`, mono: true },
                          ...(market.priceThresholdKind === 2
                            ? [{ label: "Upper bound", value: `$${Number(formatUnits(market.priceUpperBound, 8)).toLocaleString(undefined, { maximumFractionDigits: 6 })}`, mono: true }]
                            : []),
                        ]
                      : []),
                  ].map(({ label, value, valueClass, mono }) => (
                    <div key={label} className="flex cursor-default items-center justify-between py-2.5 transition hover:bg-[var(--surface-hover)]">
                      <span className="text-[var(--muted)]">{label}</span>
                      <span className={`text-right ${mono ? "font-mono" : ""} ${valueClass ?? "text-[var(--foreground)]"}`}>{value}</span>
                    </div>
                  ))}
                  {market.kind === "Event" && (
                    <p className="pt-2 text-xs text-[var(--muted)]">
                      Resolved by community admin signatures (3-of-10).
                    </p>
                  )}
                </div>

              </div>
            )}
            </div>
          </div>

          {/* ── Right: trade panel (desktop only, active markets) ── */}
          {market.marketState !== 2 && (
            <div className="hidden w-full shrink-0 lg:flex lg:sticky lg:top-4 lg:h-[min(calc(100dvh-5rem),36rem)] lg:w-[380px] lg:flex-col lg:self-start">
              <div className="glass-panel m-4 flex h-[calc(100%-2rem)] min-h-0 w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl">
                <TradeModal
                  inline
                  open={false}
                  onClose={() => {}}
                  marketTitle={market.title}
                  priceRangeLine={market.priceBinByOutcome?.[selectedOutcome] ?? null}
                  stakeEnds={market.stakeEnds}
                  resolveAfter={market.resolveAfter}
                  outcomeLabels={market.outcomeLabels}
                  selectedOutcomeIndex={selectedOutcome}
                  onSelectOutcome={setSelectedOutcome}
                  outcomeChancePcts={market.outcomeChancePcts}
                  hideOutcomeSelector={market.outcomes > 2}
                  isWalletConnected={Boolean(address)}
                  collateralDecimals={market.collateralDecimals}
                  collateralTicker={collateralTickerFromDeployment(market.collateralAddress)}
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
                  onSubmit={() => void submitTrade()}
                  onSubmitLimit={submitLimitOrderFromParams}
                  tradeSuccess={tradeSuccess}
                  onDismissSuccess={() => setTradeSuccess(null)}
                />
              </div>
            </div>
          )}

        </div>
      )}

      {market && !tradeOpen && (
        <MobileOutcomeBar
          market={market}
          onSelectOutcome={(index) => {
            setSelectedOutcome(index);
            setTradeOpen(true);
            setTradeStatus("");
            setTradeSuccess(null);
          }}
        />
      )}

      {!hasWalletConnectProjectId && (
        <p className="px-4 py-3 text-sm text-red-400 md:px-6">
          Add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env for full wallet support.
        </p>
      )}

      {market && (
        <TradeModal
          presentation="sheet"
          open={tradeOpen}
          onClose={() => {
            setTradeOpen(false);
            setTradeStatus("");
            setTradeSuccess(null);
            setTradeAmount("");
          }}
          marketTitle={market.title}
          priceRangeLine={market.priceBinByOutcome?.[selectedOutcome] ?? null}
          stakeEnds={market.stakeEnds}
          resolveAfter={market.resolveAfter}
          outcomeLabels={market.outcomeLabels}
          selectedOutcomeIndex={selectedOutcome}
          onSelectOutcome={setSelectedOutcome}
          outcomeChancePcts={market.outcomeChancePcts}
          hideOutcomeSelector={market.outcomes > 2}
          isWalletConnected={Boolean(address)}
          collateralDecimals={market.collateralDecimals}
          collateralTicker={collateralTickerFromDeployment(market.collateralAddress)}
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
            setTradeOpen(false);
            setTradeAmount("");
          }}
        />
      )}
    </AppLayout>
  );
}

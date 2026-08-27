"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react";
import {
  formatUnits,
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
  zeroAddress,
} from "viem";
import { useSessionWallet } from "@/lib/session-wallet";
import { AppLayout } from "@/app/components/app-layout";
import { useSidebarOpen } from "@/app/components/sidebar-context";
import { MarketChartPanel } from "@/app/market/components/market-chart-panel";
import { MarketShareButton } from "@/app/market/components/market-share-button";
import { MarketTradeList } from "@/app/market/components/market-trade-list";
import { LaunchpadTokenSection } from "@/app/market/components/launchpad-token-section";
import { MultiOutcomeMarketSection } from "@/app/market/components/multi-outcome-market-section";
import { OutcomeOrderBook } from "@/app/market/components/outcome-order-book";
import { LimitOrderParams, TradeModal, type TradeSuccessResult } from "@/app/market/components/trade-modal";
import { hasWalletConnectProjectId } from "@/app/wagmi-config";
import { collateralTickerFromDeployment, isUsdStyledCollateralTicker } from "@/lib/deployment-collateral";
import { formatMarketCardDate, formatMarketClosesTooltip } from "@/lib/market-cover";
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
  metadataLaunchpadMarket,
  metadataOutcomeLabels,
  metadataTitle,
} from "@/lib/markets/fetch-metadata-client";
import {
  cacheMarketCardForDetail,
  readCachedMarketCard,
  type CachedMarketCard,
} from "@/lib/markets/market-card-cache";
import deployment, { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL, wrongNetworkMessage } from "@/lib/deployment";
import { isFpmmMarket } from "@/lib/market-mechanism";
import { formatUserTxError } from "@/lib/tx-error";
import { tradeFeesFromAmount } from "@/lib/trade-fees";
import { applySlippageMaxIn, applySlippageMinOut, estimateFpmmBuyTokensOut, estimateFpmmSellTokensIn, estimateMaxFpmmSellReturn } from "@/lib/fpmm-trade";
import {
  MARKET_READ_ABI,
  marketBuyCall,
  marketSellCall,
} from "@/lib/market-abi";
import {
  DEFAULT_SLIPPAGE_BPS,
  clampSlippageBps,
  readDefaultSlippageBps,
  writeDefaultSlippageBps,
} from "@/lib/trade-slippage";
const WAD = BigInt("1000000000000000000");

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

type Props = {
  address: string;
  /** Raw `/market/[param]` segment (address or slug) — used to resolve vanity URLs. */
  routeParam?: string;
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

function MarketDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const body = text.trim();
  if (!body || body === "No description provided.") return null;
  const long = body.length > 180 || body.split("\n").length > 2;

  return (
    <div className="mt-2.5 max-w-2xl">
      <p
        className={`whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)] ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {body}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-[var(--foreground)] underline underline-offset-2 transition hover:opacity-80"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
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
    <div className="fixed bottom-[5.5rem] left-0 right-0 z-20 bg-[var(--background)] px-4 py-3 md:bottom-0 lg:hidden">
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
  routeParam,
  initialMarket = null,
  initialLoadError = null,
}: Props) {
  const router = useRouter();
  const publicClient = deploymentPublicClient;
  const { address, chainId, writeContract } = useSessionWallet();

  const routeKey = (routeParam || addressProp || "").trim();

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
  const [slugAddress, setSlugAddress] = useState<`0x${string}` | null>(() => {
    const a = initialMarket?.address?.trim();
    if (a && isAddress(a)) {
      try {
        return getAddress(a) as `0x${string}`;
      } catch {
        return null;
      }
    }
    return null;
  });
  const needsSlugResolve =
    Boolean(routeKey) &&
    !isAddress(routeKey) &&
    !(initialMarket?.address && isAddress(initialMarket.address));
  const [slugResolving, setSlugResolving] = useState(needsSlugResolve);
  const [slugResolveFailed, setSlugResolveFailed] = useState(false);

  const [tradeOpen, setTradeOpen] = useState(false);
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
  const [tradeModalClock, setTradeModalClock] = useState(0);

  // Limit order state (UI state is internal to TradeModal; parent only tracks refresh tick)
  const [limitRefreshTick, setLimitRefreshTick] = useState(0);
  const [outcomeTokens, setOutcomeTokens] = useState<Record<number, `0x${string}`>>({});
  const [outcomeTokenBalance, setOutcomeTokenBalance] = useState<bigint | null>(null);
  const [outcomeTokenAllowance, setOutcomeTokenAllowance] = useState<bigint | null>(null);
  const [marketIsFpmm, setMarketIsFpmm] = useState(false);
  const [obSnapshot, setObSnapshot] = useState<ObSnapshot | null>(null);
  const [chartThemeKey, setChartThemeKey] = useState(() =>
    typeof document !== "undefined"
      ? (document.documentElement.getAttribute("data-theme") ?? "dark")
      : "dark",
  );
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  /** 0 = full hero visible, 1 = compact overlay fully shown */
  const [headerCompact, setHeaderCompact] = useState(0);
  const headerCompactRef = useRef(0);
  const scrollRafRef = useRef(0);
  useEffect(() => {
    const sync = () => setChartThemeKey(document.documentElement.getAttribute("data-theme") ?? "dark");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const onDetailScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const scroller = detailScrollRef.current;
      const hero = heroRef.current;
      if (!scroller || !hero) return;
      // Progress over the hero's own height — hero stays in normal flow (no sticky
      // height changes), so scrollTop isn't fighting a shrinking sticky box.
      const range = Math.max(72, hero.offsetHeight - 48);
      const next = Math.min(1, Math.max(0, scroller.scrollTop / range));
      if (Math.abs(headerCompactRef.current - next) < 0.008) return;
      headerCompactRef.current = next;
      setHeaderCompact(next);
    });
  }, []);

  // Resolve vanity slug → address on the client when SSR didn't (cold cache / soft nav).
  useEffect(() => {
    const raw = routeKey;
    if (!raw || isAddress(raw)) {
      setSlugAddress(null);
      setSlugResolving(false);
      setSlugResolveFailed(false);
      return;
    }
    // Already have a market from SSR / prior resolve
    if (initialMarket?.address && isAddress(initialMarket.address)) {
      try {
        setSlugAddress(getAddress(initialMarket.address) as `0x${string}`);
        setSlugResolving(false);
        setSlugResolveFailed(false);
        return;
      } catch {
        // continue to API resolve
      }
    }

    let cancelled = false;
    setSlugResolving(true);
    setSlugResolveFailed(false);
    setLoadError("");
    void fetch(`/api/market/slug?slug=${encodeURIComponent(raw)}`, { cache: "no-store" })
      .then(async (res) => {
        const j = (await res.json()) as { address?: string | null; available?: boolean; error?: string };
        if (cancelled) return;
        const addr = typeof j.address === "string" ? j.address.trim() : "";
        if (addr && isAddress(addr)) {
          const checksum = getAddress(addr) as `0x${string}`;
          setSlugAddress(checksum);
          setSlugResolveFailed(false);
          // Replace vanity slug URL with address-only path.
          router.replace(`/market/${checksum}`);
        } else {
          setSlugAddress(null);
          setSlugResolveFailed(true);
          setLoadError(j.error || "Market not found for this link.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSlugAddress(null);
          setSlugResolveFailed(true);
          setLoadError("Could not resolve market link.");
        }
      })
      .finally(() => {
        if (!cancelled) setSlugResolving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [routeKey, initialMarket?.address]);

  const marketAddress = useMemo(() => {
    const candidates = [slugAddress, market?.address, initialMarket?.address, addressProp];
    for (const c of candidates) {
      const raw = (c || "").trim();
      if (!raw || !isAddress(raw)) continue;
      try {
        return getAddress(raw) as `0x${string}`;
      } catch {
        // try next
      }
    }
    return null;
  }, [slugAddress, addressProp, initialMarket?.address, market?.address]);

  useEffect(() => {
    headerCompactRef.current = 0;
    setHeaderCompact(0);
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [marketAddress]);

  const reload = useCallback(async () => {
    if (!marketAddress) {
      // Keep spinner while vanity slug is still resolving — don't flash "invalid".
      if (!slugResolving) setIsLoading(false);
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
  }, [marketAddress, initialMarket, slugResolving]);

  useEffect(() => {
    if (!marketAddress) {
      setMarketIsFpmm(false);
      return;
    }
    let cancelled = false;
    void isFpmmMarket(deploymentPublicClient, marketAddress).then((fpmm) => {
      if (!cancelled) setMarketIsFpmm(fpmm);
    });
    return () => {
      cancelled = true;
    };
  }, [marketAddress]);

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
          abi: MARKET_READ_ABI,
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
            nadMarket: metadataLaunchpadMarket(md) ?? prev.nadMarket,
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
        const p = await readMarketPrice(market.address, selectedOutcome, MARKET_READ_ABI);
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
      if (tradeSide === "sell") {
        const sharesWei = (amountWei * WAD) / tradePriceRaw;
        if (sharesWei === BigInt(0)) return null;
        return {
          spend: formatUnits(amountWei, market.collateralDecimals),
          tokens: formatUnits(sharesWei, market.collateralDecimals),
          amountWei,
          sharesWei,
        };
      }
      const { netAmount } = tradeFeesFromAmount(amountWei);
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
  }, [market, tradePriceRaw, tradeAmount, tradeSide]);

  const pricePerTokenLabel = useMemo(() => {
    if (!tradeSummary || tradeSummary.sharesWei === BigInt(0) || !market) return null;
    const raw = (tradeSummary.amountWei * WAD) / tradeSummary.sharesWei;
    const s = formatUnits(raw, 18);
    const ticker = collateralTickerFromDeployment(market.collateralAddress);
    return formatMoneyAmount(s, ticker);
  }, [tradeSummary, market?.collateralAddress]);

  const isNativeCollateral = Boolean(market?.collateralAddress?.toLowerCase() === zeroAddress.toLowerCase());

  const tradeDisabled = useMemo(() => {
    void tradeModalClock;
    if (!market) return true;
    const now = Math.floor(Date.now() / 1000);
    if (market.marketState !== 0) return true;
    if (now >= market.resolveAfterUnix) return true;
    if (tradeSide === "buy" && now >= market.stakeEndUnix) return true;
    if (marketIsFpmm && market.collateralAddress.toLowerCase() === zeroAddress.toLowerCase()) return true;
    if (tradeSide === "sell" && !marketIsFpmm) return true;
    return false;
  }, [market, marketIsFpmm, tradeModalClock, tradeSide]);

  useEffect(() => {
    setTradeSlippageBps(readDefaultSlippageBps());
  }, []);

  const setTradeSlippageDefault = (bps: number) => {
    const next = clampSlippageBps(bps);
    setTradeSlippageBps(next);
    writeDefaultSlippageBps(next);
  };

  const fillMaxSell = async () => {
    if (!market || !publicClient || outcomeTokenBalance == null || outcomeTokenBalance <= BigInt(0)) {
      return;
    }
    try {
      const maxReturn = await estimateMaxFpmmSellReturn(
        publicClient,
        market.address,
        selectedOutcome,
        outcomeTokenBalance,
      );
      if (maxReturn <= BigInt(0)) {
        setTradeStatus("No sellable size for this pool.");
        return;
      }
      setTradeAmount(formatUnits(maxReturn, market.collateralDecimals));
    } catch (error) {
      setTradeStatus(formatTradeError(error));
    }
  };

  const submitTrade = async (side: "buy" | "sell" = "buy") => {
    if (!market || !publicClient || !address) {
      setTradeStatus("Connect wallet first.");
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    if (market.marketState !== 0) {
      setTradeStatus(`Market is ${market.stateLabel.toLowerCase()}.`);
      return;
    }
    if (now >= market.resolveAfterUnix) {
      setTradeStatus("Trading closed for this market.");
      return;
    }
    if (side === "buy" && now >= market.stakeEndUnix) {
      setTradeStatus("Trading closed for this market.");
      return;
    }
    if (side === "sell" && !marketIsFpmm) {
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
      const amountUnits = parseUnits(tradeAmount, market.collateralDecimals);
      const currentPrice = tradePriceRaw;
      if (!currentPrice || currentPrice <= BigInt(0)) {
        setTradeStatus("Market price unavailable. Refresh and try again.");
        return;
      }

      if (side === "sell") {
        const token = outcomeTokens[selectedOutcome];
        if (!token) {
          setTradeStatus("Fetching share token — try again.");
          return;
        }
        const tokensIn = await estimateFpmmSellTokensIn(
          publicClient,
          market.address,
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
          address: token,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, market.address],
        })) as bigint;
        if (allowance < maxOutcomeTokens) {
          const approveHash = await writeContract({
            address: token,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [market.address, maxOutcomeTokens],
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
          address: market.address,
          abi: sellCall.abi,
          functionName: sellCall.functionName,
          args: sellCall.args as never,
          account: address,
          gas: BigInt(500_000),
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        const tick = collateralTickerFromDeployment(market.collateralAddress);
        const receiveLabel = isUsdStyledCollateralTicker(tick)
          ? `$${tradeAmount} ${tick}`
          : `${tradeAmount} ${tick}`;
        setTradeSuccess({
          outcomeLabel: market.outcomeLabels[selectedOutcome] ?? `Outcome ${selectedOutcome + 1}`,
          amountLabel: receiveLabel,
          sharesLabel: formatUnits(tokensIn, market.collateralDecimals),
          txHash,
          side: "sell",
        });
        setTradeStatus("");
        setTradeAmount("");
        void reload();
        return;
      }

      let minSharesOut: bigint;
      if (marketIsFpmm) {
        const expectedOut = await estimateFpmmBuyTokensOut(
          publicClient,
          market.address,
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
      const isNative = market.collateralAddress.toLowerCase() === zeroAddress.toLowerCase();
      if (!isNative) {
        const allowance = (await publicClient.readContract({
          address: market.collateralAddress,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, market.address],
        })) as bigint;
        if (allowance < amountUnits) {
          const approveHash = await writeContract({
            address: market.collateralAddress,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [market.address, amountUnits],
            account: address,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }
      if (Math.floor(Date.now() / 1000) >= market.stakeEndUnix) {
        setTradeStatus("Trading has closed for this market.");
        return;
      }
      const buyCall = marketBuyCall(marketIsFpmm, {
        outcomeIndex: selectedOutcome,
        amountUnits,
        recipient: address,
        minSharesOut,
      });
      const txHash = await writeContract({
        address: market.address,
        abi: buyCall.abi,
        functionName: buyCall.functionName,
        args: buyCall.args as never,
        account: address,
        value: !marketIsFpmm && isNative ? amountUnits : undefined,
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
        side: "buy",
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
          abi: MARKET_READ_ABI,
          functionName: "outcomeToken",
          args: [BigInt(selectedOutcome)],
        })) as `0x${string}`;
        if (!cancelled) setOutcomeTokens((prev) => ({ ...prev, [selectedOutcome]: token }));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [market, publicClient, selectedOutcome, outcomeTokens]);

  // Fetch outcome token balance + market allowance (for sell)
  useEffect(() => {
    const token = outcomeTokens[selectedOutcome];
    if (!market || !publicClient || !address || !token) {
      setOutcomeTokenBalance(null);
      setOutcomeTokenAllowance(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [bal, allowance] = await Promise.all([
          publicClient.readContract({
            address: token,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: token,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, market.address],
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
  }, [market, publicClient, address, selectedOutcome, outcomeTokens, limitRefreshTick, tradeBusy]);

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
    if (!market || !publicClient || !address) throw new Error("Connect wallet first.");
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
        const h = await writeContract({
          address: token, abi: ERC20_ABI,
          functionName: "approve", args: [ORDERBOOK_ADDRESS, amountUnits], account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      const tx = await writeContract({
        address: ORDERBOOK_ADDRESS, abi: ORDERBOOK_ABI,
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
        const h = await writeContract({
          address: market.collateralAddress, abi: ERC20_ABI,
          functionName: "approve", args: [ORDERBOOK_ADDRESS, escrow], account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      const tx = await writeContract({
        address: ORDERBOOK_ADDRESS, abi: ORDERBOOK_ABI,
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
    if (slugResolving || (routeKey && !isAddress(routeKey) && !slugResolveFailed)) {
      return (
        <AppLayout showSearch={false}>
          <div className="no-scrollbar h-full overflow-y-auto">
            <div className="px-4 pt-2 md:px-6">
              <div className="mb-4 h-4 w-24 animate-pulse rounded bg-[var(--border)]/50" />
              <div className="mb-4 h-[120px] w-full max-w-2xl animate-pulse rounded-2xl bg-[var(--border)]/50 sm:h-[140px] md:h-[160px]" />
              <div className="mt-6 h-[400px] animate-pulse rounded-xl bg-[var(--card)]" />
            </div>
          </div>
        </AppLayout>
      );
    }
    return (
      <AppLayout showSearch={false}>
        <div className="flex min-h-[40vh] items-center justify-center px-4">
          <div>
            <p className="text-base font-semibold text-red-400">
              {slugResolveFailed
                ? loadError || "Market not found for this link."
                : "Invalid market address"}
            </p>
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
            <div className="mb-4 h-[120px] w-full max-w-2xl animate-pulse rounded-2xl bg-[var(--border)]/50 sm:h-[140px] md:h-[160px]" />
            <div className="mt-6 h-[400px] animate-pulse rounded-xl bg-[var(--card)]" />
          </div>
        </div>
      )}

      {loadError && (
        <p className="px-4 py-6 text-sm text-red-400 md:px-6">{loadError}</p>
      )}

      {market && (
        <div className="flex h-full min-h-0 overflow-hidden lg:flex-row">

          {/* ── Left: hero scrolls away; compact bar overlays without changing layout ── */}
          <div
            ref={detailScrollRef}
            onScroll={onDetailScroll}
            className="no-scrollbar relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {/* Compact sticky overlay — zero layout height, so no scroll feedback loop */}
            <div
              className="pointer-events-none sticky top-0 z-30 h-0 overflow-visible"
              aria-hidden={headerCompact < 0.2}
            >
              <div
                className={`border-b border-[var(--border)] bg-[var(--background)]/95 px-4 py-2.5 shadow-[0_8px_24px_rgb(0_0_0_/_0.18)] backdrop-blur-md supports-[backdrop-filter]:bg-[var(--background)]/85 md:px-6 ${
                  market.marketState === 2 ? "mx-auto w-full max-w-3xl" : ""
                }`}
                style={{
                  opacity: Math.min(1, Math.max(0, (headerCompact - 0.12) / 0.55)),
                  transform: `translate3d(0, ${Math.round((1 - Math.min(1, headerCompact / 0.7)) * -10)}px, 0)`,
                  pointerEvents: headerCompact > 0.35 ? "auto" : "none",
                  willChange: "opacity, transform",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <Link
                      href="/market"
                      className="inline-flex shrink-0 items-center justify-center rounded-lg p-1 text-[var(--muted)] transition hover:text-[var(--foreground)]"
                      aria-label="Back to markets"
                    >
                      <ArrowLeft size={16} weight="bold" />
                    </Link>
                    {market.imageUrl ? (
                      <div className="relative isolate h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-[var(--surface)]">
                        <img
                          src={market.imageUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover object-center"
                        />
                      </div>
                    ) : null}
                    <h1 className="truncate text-base font-bold leading-snug text-[var(--foreground)]">
                      {market.title}
                    </h1>
                  </div>
                  <MarketShareButton
                    address={market.address}
                    slug={market.slug}
                    title={market.title}
                    iconSize={16}
                    className="shrink-0 text-[var(--muted)]"
                  />
                </div>
              </div>
            </div>

            {/* Expanded hero — normal document flow; scrolls under the compact bar */}
            <div
              ref={heroRef}
              className={`px-4 pb-1 pt-2 md:px-6 ${
                market.marketState === 2 ? "mx-auto w-full max-w-3xl" : ""
              }`}
              style={{
                opacity: Math.max(0, 1 - headerCompact * 1.15),
                transform: `translate3d(0, ${Math.round(headerCompact * -6)}px, 0)`,
                willChange: "opacity, transform",
              }}
            >
              <Link
                href="/market"
                className="mb-2 inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                <ArrowLeft size={14} weight="bold" /> Markets
              </Link>

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="text-[1.4rem] font-bold leading-snug text-[var(--foreground)]">
                    {market.title}
                  </h1>
                  {market.slug ? (
                    <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">/{market.slug}</p>
                  ) : null}
                  <MarketDescription text={market.description} />
                </div>
                <MarketShareButton
                  address={market.address}
                  slug={market.slug}
                  title={market.title}
                  iconSize={18}
                  className="shrink-0 text-[var(--muted)]"
                />
              </div>

              {market.imageUrl ? (
                <div className="relative isolate mt-3 h-[132px] w-full max-w-2xl overflow-hidden rounded-2xl bg-[var(--surface)] sm:h-[148px]">
                  <img
                    src={market.imageUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover object-center"
                  />
                  <div
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent"
                    aria-hidden
                  />
                </div>
              ) : null}
            </div>

            <div
              className={`px-4 pb-28 pt-3 md:px-6 lg:pb-6 ${
                market.marketState === 2 ? "mx-auto w-full max-w-3xl" : ""
              }`}
            >
            {/* Outcome hero — binary only */}
            {market.outcomes === 2 && (
              <>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-[var(--outcome-yes)]">
                    {market.outcomeLabels[0] ?? "Yes"}
                  </span>
                  <span className="text-sm font-semibold text-[var(--outcome-yes)]">
                    ↑ {market.chancePct.toFixed(1)}%
                  </span>
                </div>
                <p className="mb-5 text-sm text-[var(--muted)]">
                  {market.chancePct.toFixed(1)}% chance
                </p>
              </>
            )}

            {market.outcomes > 2 || market.nadMarket?.mode === "comparison" ? (
              <>
                <MultiOutcomeMarketSection
                  labels={market.outcomeLabels}
                  chancePcts={market.outcomeChancePcts ?? []}
                  selectedIndex={selectedOutcome}
                  nadMarket={market.nadMarket ?? null}
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
                {market.nadMarket ? (
                  <div className="mt-6">
                    <LaunchpadTokenSection
                      nadMarket={market.nadMarket}
                      marketKind={market.kind}
                      marketAddress={market.address}
                      collateralDecimals={market.collateralDecimals}
                      collateralTicker={collateralTickerFromDeployment(market.collateralAddress)}
                      outcomeLabels={market.outcomeLabels}
                      chartThemeKey={chartThemeKey}
                      hideMarketChartFallback
                    />
                  </div>
                ) : null}
                <MarketTradeList
                  marketAddress={market.address}
                  collateralDecimals={market.collateralDecimals}
                  collateralTicker={collateralTickerFromDeployment(market.collateralAddress)}
                  outcomeLabels={market.outcomeLabels}
                  className="mt-6"
                />
              </>
            ) : market.nadMarket ? (
              <LaunchpadTokenSection
                nadMarket={market.nadMarket}
                marketKind={market.kind}
                marketAddress={market.address}
                collateralDecimals={market.collateralDecimals}
                collateralTicker={collateralTickerFromDeployment(market.collateralAddress)}
                outcomeLabels={market.outcomeLabels}
                chartThemeKey={chartThemeKey}
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
                      Resolved through protocol admins.
                    </p>
                  )}
                </div>

              </div>
            )}
            </div>
          </div>

          {/* ── Right: trade + order book (desktop) ── */}
          {market.marketState !== 2 && (
            <aside className="hidden min-h-0 w-[min(100%,400px)] shrink-0 flex-col self-stretch lg:flex lg:h-full lg:w-[400px] xl:w-[440px]">
              <div className="flex h-full min-h-0 flex-col p-3 pl-2 xl:p-4 xl:pl-2">
                <div className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
                  <TradeModal
                    inline
                    open={false}
                    onClose={() => {}}
                    marketTitle={market.title}
                    priceRangeLine={market.priceBinByOutcome?.[selectedOutcome] ?? null}
                    stakeEnds={market.stakeEnds}
                    resolveAfter={
                      formatMarketCardDate(market.resolveAfterUnix * 1000) ?? market.resolveAfter
                    }
                    resolveAfterTooltip={formatMarketClosesTooltip(market.resolveAfterUnix * 1000)}
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
                    collateralFormatted={tradeSummary?.spend ?? null}
                    pricePerTokenLabel={pricePerTokenLabel}
                    slippageBps={tradeSlippageBps}
                    onSlippageBpsChange={setTradeSlippageDefault}
                    isNativeCollateral={isNativeCollateral}
                    tradeDisabled={tradeDisabled}
                    status={tradeStatus}
                    busy={tradeBusy}
                    marketSellEnabled={marketIsFpmm}
                    marketSide={tradeSide}
                    onMarketSideChange={setTradeSide}
                    onFillMaxSell={() => void fillMaxSell()}
                    onSubmit={(side) => void submitTrade(side)}
                    onSubmitLimit={submitLimitOrderFromParams}
                    tradeSuccess={tradeSuccess}
                    onDismissSuccess={() => setTradeSuccess(null)}
                    belowPanel={
                      market.marketState === 0 ? (
                        <OutcomeOrderBook
                          snapshot={obSnapshot}
                          collateralDecimals={market.collateralDecimals}
                          title={`Order book · ${market.outcomeLabels[selectedOutcome] ?? `Outcome ${selectedOutcome}`}`}
                        />
                      ) : null
                    }
                  />
                </div>
              </div>
            </aside>
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
          resolveAfter={
            formatMarketCardDate(market.resolveAfterUnix * 1000) ?? market.resolveAfter
          }
          resolveAfterTooltip={formatMarketClosesTooltip(market.resolveAfterUnix * 1000)}
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
          collateralFormatted={tradeSummary?.spend ?? null}
          pricePerTokenLabel={pricePerTokenLabel}
          slippageBps={tradeSlippageBps}
          onSlippageBpsChange={setTradeSlippageDefault}
          isNativeCollateral={isNativeCollateral}
          tradeDisabled={tradeDisabled}
          status={tradeStatus}
          busy={tradeBusy}
          marketSellEnabled={marketIsFpmm}
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
            setTradeOpen(false);
            setTradeAmount("");
            setTradeSide("buy");
          }}
          belowPanel={
            market.marketState === 0 ? (
              <OutcomeOrderBook
                snapshot={obSnapshot}
                collateralDecimals={market.collateralDecimals}
                title={`Order book · ${market.outcomeLabels[selectedOutcome] ?? `Outcome ${selectedOutcome}`}`}
              />
            ) : null
          }
        />
      )}
    </AppLayout>
  );
}

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
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import { LimitOrderParams, TradeModal } from "@/app/market/components/trade-modal";
import { hasWalletConnectProjectId } from "@/app/wagmi-config";
import deployment from "@/deployments/baseSepolia-84532.json";

const DEPLOYMENT_CHAIN_ID = deployment.chainId;
const WAD = BigInt("1000000000000000000");
const UMA_BINARY_YES = BigInt("1000000000000000000");
const SLIPPAGE_PRESETS = [50, 100, 200, 300] as const;

const ORDERBOOK_ADDRESS = (deployment as unknown as { contracts: Record<string, string> }).contracts
  .AFTROrderBook as `0x${string}`;

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
  "function umaIdentifier() view returns (bytes32)",
]);

const FEED_ABI = parseAbi(["function decimals() view returns (uint8)"]);

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

/** Solidity `bytes32` string literals (right-padded), matching `AFTRUmaIdentifiers`. */
const YES_OR_NO_QUERY_ID =
  "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000" as const;
const MULTIPLE_CHOICE_QUERY_ID =
  "0x4d554c5449504c455f43484f4943455f51554552590000000000000000000000" as const;

type IpfsMetadata = {
  title?: string;
  description?: string;
  image?: string;
  outcomes?: string[];
  slug?: string;
};

type DetailModel = {
  address: `0x${string}`;
  kind: "Event" | "Price";
  title: string;
  description: string;
  imageUrl: string;
  outcomeLabels: string[];
  outcomes: number;
  stakeEndUnix: number;
  resolveAfterUnix: number;
  stakeEnds: string;
  resolveAfter: string;
  marketState: number;
  stateLabel: string;
  poolTvl: string;
  chancePct: number;
  collateralAddress: `0x${string}`;
  collateralDecimals: number;
  priceBinByOutcome?: string[];
  winningOutcomeIndex: number | null;
  settledOraclePrice: bigint;
  settlementTimestamp: number;
  redemptionRate: bigint;
  priceThreshold: bigint;
  priceThresholdKind: number;
  priceUpperBound: bigint;
  chainlinkFeed: `0x${string}`;
  feedDecimals: number;
  umaIdentifier: `0x${string}`;
  usesBins: boolean;
  slug?: string;
};

function ipfsToHttp(uri: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.lighthouse.storage/ipfs/${uri.replace("ipfs://", "")}`;
  }
  return uri;
}

async function fetchIpfsMetadata(uri: string): Promise<IpfsMetadata | null> {
  const httpUrl = ipfsToHttp(uri);
  if (!httpUrl) return null;
  try {
    const res = await fetch(httpUrl, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as IpfsMetadata;
  } catch {
    return null;
  }
}

function fmtTsFromUnix(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

function fmtTs(value: bigint) {
  const ms = Number(value) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
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

function priceKindName(kind: number): string {
  if (kind === 0) return "Above threshold";
  if (kind === 1) return "Below threshold";
  if (kind === 2) return "In range";
  return `Kind ${kind}`;
}


function TradingViewChart({ symbol }: { symbol: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = "tv_chart_detail";
    let script: HTMLScriptElement | null = null;
    function init() {
      const tv = (window as unknown as { TradingView?: { widget: new (o: unknown) => void } }).TradingView;
      if (!tv || !document.getElementById(id)) return;
      new tv.widget({
        container_id: id, symbol, interval: "60", timezone: "Etc/UTC",
        theme: "dark", style: "1", locale: "en", autosize: true,
        hide_top_toolbar: false, allow_symbol_change: false, save_image: false,
        backgroundColor: "#050507", gridColor: "rgba(139,92,246,0.04)",
      });
    }
    if ((window as unknown as { TradingView?: unknown }).TradingView) { init(); }
    else {
      script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = init;
      document.head.appendChild(script);
    }
    return () => { if (script && document.head.contains(script)) document.head.removeChild(script); };
  }, [symbol]);
  return (
    <div ref={ref} className="h-[400px] w-full overflow-hidden rounded-xl border border-[var(--border)]">
      <div id="tv_chart_detail" className="h-full w-full" />
    </div>
  );
}

type Props = { address: string };

export function MarketDetailClient({ address: addressProp }: Props) {
  const publicClient = usePublicClient({ chainId: DEPLOYMENT_CHAIN_ID });
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [market, setMarket] = useState<DetailModel | null>(null);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [tradeOpen, setTradeOpen] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeStatus, setTradeStatus] = useState("");
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
    if (!publicClient || !marketAddress) {
      setMarket(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const [
        kind,
        uri,
        stake,
        resolveAfter,
        outcomes,
        state,
        collateralDecimals,
        collateralAddress,
        winningRaw,
        settledRaw,
        settlementTs,
        redemptionRate,
        priceThreshold,
        priceKind,
        priceUpper,
        feed,
        umaId,
      ] = await Promise.all([
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "marketKind" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "metadataURI" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "stakeEndTimestamp" }),
        publicClient.readContract({
          address: marketAddress,
          abi: MARKET_ABI,
          functionName: "resolveAfterTimestamp",
        }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "numOutcomes" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "state" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "collateralDecimals" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "collateralAddress" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "winningOutcomeIndex" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "settledOraclePrice" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "settlementTimestamp" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "redemptionRate" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "priceThreshold" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "priceThresholdKind" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "priceUpperBound" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "chainlinkFeed" }),
        publicClient.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "umaIdentifier" }),
      ]);

      const outcomeCount = Number(outcomes);
      const dec = Number(collateralDecimals);
      const st = Number(state);
      const isPrice = Number(kind) === 0;

      const feedDec = isPrice
        ? Number(
            await publicClient.readContract({
              address: feed as `0x${string}`,
              abi: FEED_ABI,
              functionName: "decimals",
            }),
          )
        : 8;

      const realParts = await Promise.all(
        Array.from({ length: outcomeCount }, (_, i) =>
          publicClient.readContract({
            address: marketAddress,
            abi: MARKET_ABI,
            functionName: "realPool",
            args: [BigInt(i)],
          }),
        ),
      );
      const poolTvlRaw = realParts.reduce((a, v) => a + (v as bigint), BigInt(0));
      const poolTvl = Number(formatUnits(poolTvlRaw, dec)).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });

      const md = await fetchIpfsMetadata(String(uri || ""));
      const fallbackLabels = Array.from({ length: outcomeCount }, (_, i) => `Outcome ${i + 1}`);
      const labelsFromIpfs =
        md?.outcomes && md.outcomes.length > 0 ? md.outcomes.filter((x): x is string => typeof x === "string") : [];
      const outcomeLabels = labelsFromIpfs.length > 0 ? labelsFromIpfs : fallbackLabels;

      let usesBins = false;
      let priceBinByOutcome: string[] | undefined;
      if (isPrice) {
        try {
          await publicClient.readContract({
            address: marketAddress,
            abi: MARKET_ABI,
            functionName: "priceBinLower",
            args: [BigInt(0)],
          });
          usesBins = true;
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
          priceBinByOutcome = lowers.map((lo, i) => `$${fmtUsdBin(lo as bigint)} — $${fmtUsdBin(uppers[i] as bigint)}`);
        } catch {
          usesBins = false;
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
        // keep
      }

      const wr = winningRaw as bigint;
      const winIdx = st === 2 && wr < BigInt(outcomeCount) ? Number(wr) : null;

      setMarket({
        address: marketAddress,
        kind: isPrice ? "Price" : "Event",
        slug: md?.slug?.trim() || undefined,
        title: md?.title?.trim() || `${isPrice ? "Price" : "Event"} market`,
        description: md?.description?.trim() || "",
        imageUrl: ipfsToHttp(md?.image?.trim() || ""),
        outcomeLabels,
        outcomes: outcomeCount,
        stakeEndUnix: Number(stake),
        resolveAfterUnix: Number(resolveAfter),
        stakeEnds: fmtTs(stake as bigint),
        resolveAfter: fmtTs(resolveAfter as bigint),
        marketState: st,
        stateLabel: stateLabel(st),
        poolTvl,
        chancePct: leftPct,
        collateralAddress: collateralAddress as `0x${string}`,
        collateralDecimals: dec,
        priceBinByOutcome,
        winningOutcomeIndex: winIdx,
        settledOraclePrice: settledRaw as bigint,
        settlementTimestamp: Number(settlementTs),
        redemptionRate: redemptionRate as bigint,
        priceThreshold: priceThreshold as bigint,
        priceThresholdKind: Number(priceKind),
        priceUpperBound: priceUpper as bigint,
        chainlinkFeed: feed as `0x${string}`,
        feedDecimals: feedDec,
        umaIdentifier: umaId as `0x${string}`,
        usesBins,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load market.");
      setMarket(null);
    } finally {
      setIsLoading(false);
    }
  }, [publicClient, marketAddress]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
        const p = await publicClient.readContract({
          address: market.address,
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
      const sharesWei = (amountWei * WAD) / tradePriceRaw;
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
    const ticker = market.collateralAddress.toLowerCase() === zeroAddress.toLowerCase() ? "ETH" : "USDC";
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
    const tick = isNativeCollateral ? "ETH" : "USDC";
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
      const amountUnits = parseUnits(tradeAmount, market.collateralDecimals);
      const currentPrice = (await publicClient.readContract({
        address: market.address,
        abi: MARKET_ABI,
        functionName: "priceOf",
        args: [selectedOutcome],
      })) as bigint;
      const estShares = (amountUnits * WAD) / currentPrice;
      const slipBps = Math.min(5000, Math.max(1, tradeSlippageBps));
      const minSharesOut = (estShares * BigInt(10_000 - slipBps)) / BigInt(10000);
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
      setTradeStatus("Trade successful.");
      setTradeAmount("");
      void reload();
    } catch (error) {
      setTradeStatus(error instanceof Error ? error.message : "Trade failed.");
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
    if (chainId !== DEPLOYMENT_CHAIN_ID) throw new Error(`Switch to Base Sepolia (${DEPLOYMENT_CHAIN_ID}).`);
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

  const umaResultLine = useMemo(() => {
    if (!market || market.marketState !== 2 || market.kind !== "Event") return null;
    const p = market.settledOraclePrice;
    const id = market.umaIdentifier.toLowerCase();
    if (id === YES_OR_NO_QUERY_ID.toLowerCase()) {
      if (p === UMA_BINARY_YES) return "UMA result: YES (1e18) → outcome 0 wins.";
      return "UMA result: not YES (1e18) → outcome 1 wins (binary).";
    }
    if (id === MULTIPLE_CHOICE_QUERY_ID.toLowerCase()) {
      return `UMA multiple-choice result: ${p.toString()} → winning outcome index ${market.winningOutcomeIndex ?? "—"}.`;
    }
    return `UMA result (raw): ${p.toString()} → winning index ${market.winningOutcomeIndex ?? "—"}.`;
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
    <AppLayout showSearch={false}>
      {/* back */}
      <div className="border-b border-[var(--border)] px-4 py-3 md:px-6">
        <Link href="/market" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]">
          <ArrowLeft size={14} weight="bold" /> Markets
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-4 px-4 py-6 md:px-6">
          <div className="h-8 w-2/3 animate-pulse rounded-lg bg-[var(--card)]" />
          <div className="h-5 w-1/3 animate-pulse rounded-lg bg-[var(--card)]" />
          <div className="mt-6 h-[400px] animate-pulse rounded-xl bg-[var(--card)]" />
        </div>
      )}

      {loadError && (
        <p className="px-4 py-6 text-sm text-red-400 md:px-6">{loadError}</p>
      )}

      {market && (
        <div className="flex flex-col gap-0 lg:flex-row lg:items-start">

          {/* ── Left ── */}
          <div className="min-w-0 flex-1 border-b border-[var(--border)] px-4 py-6 pb-36 md:pb-24 md:px-6 lg:border-b-0 lg:border-r lg:pb-6">

            {/* Market header */}
            <div className="mb-1 flex items-start gap-3">
              {market.imageUrl && (
                <img src={market.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
              )}
              <div>
                <h1 className="text-xl font-bold leading-snug text-[var(--foreground)] md:text-2xl">
                  {market.title}
                </h1>
                {market.slug && (
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">/{market.slug}</p>
                )}
              </div>
            </div>


            {/* Outcome hero */}
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-emerald-400">
                {market.outcomeLabels[0] ?? "Yes"}
              </span>
              <span className="text-sm font-semibold text-emerald-400">
                ↑ {market.chancePct.toFixed(1)}%
              </span>
            </div>
            <p className="mb-5 text-sm text-[var(--muted)]">
              {market.chancePct.toFixed(1)}% chance
            </p>



            {/* TradingView chart (price markets) */}
            {tvSymbol && <TradingViewChart symbol={tvSymbol} />}

            {/* Event market: outcome list (no chart) */}
            {!tvSymbol && (
              <div className="space-y-px">
                {market.outcomeLabels.map((label, i) => {
                  const pct = market.outcomes >= 2
                    ? (i === 0 ? market.chancePct : 100 - market.chancePct)
                    : Math.round(100 / market.outcomes);
                  const isWinner = market.winningOutcomeIndex === i;
                  const col = i === 0 ? "text-emerald-400" : "text-rose-400";
                  return (
                    <div key={i} className="flex cursor-default items-center justify-between py-3 transition hover:bg-[var(--surface-hover)]">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--foreground)]">{label}</span>
                        {isWinner && (
                          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300">Winner</span>
                        )}
                      </div>
                      <span className={`text-base font-bold tabular-nums ${col}`}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Order book */}
            {market.marketState === 0 && outcomeTokens[selectedOutcome] && (
              <div className="mt-8">
                <div className="mb-3 border-t border-[var(--border)] pt-5 flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    Order Book · {market.outcomeLabels[selectedOutcome] ?? `Outcome ${selectedOutcome}`}
                  </p>
                  <div className="flex gap-1">
                    {market.outcomeLabels.slice(0, 2).map((label, i) => (
                      <button key={i} type="button" onClick={() => setSelectedOutcome(i)}
                        className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition ${selectedOutcome === i ? (i === 0 ? "bg-emerald-600 text-white" : "bg-rose-600 text-white") : "text-[var(--muted)] hover:text-white"}`}>
                        {label}
                      </button>
                    ))}
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
                      valueClass: "text-emerald-300 font-semibold" },
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
                  {market.kind === "Event" && umaResultLine && (
                    <p className="pt-2 text-xs text-[var(--muted)]">{umaResultLine}</p>
                  )}
                </div>

              </div>
            )}
          </div>

          {/* ── Right: trade panel (desktop only, active markets) ── */}
          {market.marketState !== 2 && (
            <div className="hidden w-full shrink-0 lg:block lg:w-[380px]">
              <div className="sticky top-4 m-4 overflow-hidden rounded-2xl border border-[#2d1b5e] bg-[#0d0920] shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
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
                  collateralDecimals={market.collateralDecimals}
                  collateralTicker={isNativeCollateral ? "ETH" : "USDC"}
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
                  onSubmit={() => void submitTrade()}
                  onSubmitLimit={submitLimitOrderFromParams}
                />
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Mobile bottom bar ── */}
      {market && market.marketState === 0 && (
        <div className="fixed bottom-[64px] left-0 right-0 z-50 border-t border-[#2d1b5e] bg-[#0b0718]/95 px-4 py-3 backdrop-blur-md md:bottom-0 lg:hidden">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setSelectedOutcome(0); setTradeOpen(true); setTradeStatus(""); }}
              className="group flex flex-1 items-center justify-between rounded-full border border-emerald-600 bg-emerald-700 px-4 py-3 transition hover:bg-emerald-600 active:scale-[0.97]"
            >
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-200">
                {market.outcomeLabels[0] ?? "Yes"}
              </span>
              <span className="text-sm font-bold text-white tabular-nums">
                ${(market.chancePct / 100).toFixed(2)}
              </span>
            </button>
            {market.outcomes >= 2 && (
              <button
                type="button"
                onClick={() => { setSelectedOutcome(1); setTradeOpen(true); setTradeStatus(""); }}
                className="group flex flex-1 items-center justify-between rounded-full border border-rose-600 bg-rose-700 px-4 py-3 transition hover:bg-rose-600 active:scale-[0.97]"
              >
                <span className="text-xs font-bold uppercase tracking-widest text-rose-200">
                  {market.outcomeLabels[1] ?? "No"}
                </span>
                <span className="text-sm font-bold text-white tabular-nums">
                  ${((100 - market.chancePct) / 100).toFixed(2)}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {!hasWalletConnectProjectId && (
        <p className="px-4 py-3 text-sm text-red-400 md:px-6">
          Add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env for full wallet support.
        </p>
      )}

      {market && (
        <TradeModal
          open={tradeOpen}
          onClose={() => {
            setTradeOpen(false);
            setTradeStatus("");
            setTradeAmount("");
          }}
          marketTitle={market.title}
          priceRangeLine={market.priceBinByOutcome?.[selectedOutcome] ?? null}
          stakeEnds={market.stakeEnds}
          resolveAfter={market.resolveAfter}
          outcomeLabels={market.outcomeLabels}
          selectedOutcomeIndex={selectedOutcome}
          onSelectOutcome={setSelectedOutcome}
          collateralDecimals={market.collateralDecimals}
          collateralTicker={isNativeCollateral ? "ETH" : "USDC"}
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
          onSubmitLimit={submitLimitOrderFromParams}
        />
      )}
    </AppLayout>
  );
}

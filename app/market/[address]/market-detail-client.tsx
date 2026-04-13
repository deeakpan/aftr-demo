"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, TrendUp } from "@phosphor-icons/react";
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
import { TradeModal } from "@/app/market/components/trade-modal";
import { hasWalletConnectProjectId } from "@/app/wagmi-config";
import deployment from "@/deployments/baseSepolia-84532.json";

const DEPLOYMENT_CHAIN_ID = deployment.chainId;
const WAD = BigInt("1000000000000000000");
const UMA_BINARY_YES = BigInt("1000000000000000000");
const SLIPPAGE_PRESETS = [50, 100, 200, 300] as const;

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

function normalizedFromAnswer(answer: bigint, feedDec: number): bigint {
  if (feedDec >= 6) return answer / BigInt(10 ** (feedDec - 6));
  return answer * BigInt(10 ** (6 - feedDec));
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

  const [redeemShares, setRedeemShares] = useState("");
  const [redeemStatus, setRedeemStatus] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [shareBalance, setShareBalance] = useState<bigint | null>(null);
  const [shareAllowance, setShareAllowance] = useState<bigint | null>(null);

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
    if (!tradeOpen || !market) return;
    const id = setInterval(() => setTradeModalClock((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [tradeOpen, market]);

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

  useEffect(() => {
    if (!market || !publicClient || !address || market.marketState !== 2) {
      setShareBalance(null);
      setShareAllowance(null);
      return;
    }
    const w = market.winningOutcomeIndex;
    if (w === null || w < 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = (await publicClient.readContract({
          address: market.address,
          abi: MARKET_ABI,
          functionName: "outcomeToken",
          args: [BigInt(w)],
        })) as `0x${string}`;
        const [bal, alw] = await Promise.all([
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
          setShareBalance(bal);
          setShareAllowance(alw);
        }
      } catch {
        if (!cancelled) {
          setShareBalance(null);
          setShareAllowance(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [market, address, publicClient, redeemBusy, redeemShares]);

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

  const redeemableWei = useMemo(() => {
    if (!redeemShares.trim() || !market) return null;
    try {
      return parseUnits(redeemShares.trim(), market.collateralDecimals);
    } catch {
      return null;
    }
  }, [redeemShares, market]);

  const submitRedeem = async () => {
    if (!market || !publicClient || !walletClient || !address) {
      setRedeemStatus("Connect wallet first.");
      return;
    }
    if (market.marketState !== 2) {
      setRedeemStatus("Market is not settled.");
      return;
    }
    const w = market.winningOutcomeIndex;
    if (w === null || w < 0) {
      setRedeemStatus("No winner recorded.");
      return;
    }
    if (!redeemableWei || redeemableWei <= BigInt(0)) {
      setRedeemStatus("Enter a valid share amount.");
      return;
    }
    if (shareBalance !== null && redeemableWei > shareBalance) {
      setRedeemStatus("Amount exceeds your winning outcome balance.");
      return;
    }
    if (chainId !== DEPLOYMENT_CHAIN_ID) {
      setRedeemStatus(`Switch to Base Sepolia (${DEPLOYMENT_CHAIN_ID}).`);
      return;
    }
    try {
      setRedeemBusy(true);
      setRedeemStatus("Preparing…");
      const token = (await publicClient.readContract({
        address: market.address,
        abi: MARKET_ABI,
        functionName: "outcomeToken",
        args: [BigInt(w)],
      })) as `0x${string}`;
      const allowance = (await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, market.address],
      })) as bigint;
      if (allowance < redeemableWei) {
        setRedeemStatus("Approving market to redeem shares…");
        const h = await walletClient.writeContract({
          chain: walletClient.chain,
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [market.address, redeemableWei],
          account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      setRedeemStatus("Redeeming…");
      const tx = await walletClient.writeContract({
        chain: walletClient.chain,
        address: market.address,
        abi: MARKET_ABI,
        functionName: "redeem",
        args: [w, redeemableWei],
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setRedeemStatus("Redeemed.");
      setRedeemShares("");
      void reload();
    } catch (e) {
      setRedeemStatus(e instanceof Error ? e.message : "Redeem failed.");
    } finally {
      setRedeemBusy(false);
    }
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

  if (!marketAddress) {
    return (
      <AppLayout showSearch={false}>
        <section className="mx-4 pt-8 md:mx-6">
          <p className="text-sm text-red-400">Invalid market address.</p>
          <Link href="/market" className="mt-4 inline-block text-sm text-[var(--accent)]">
            ← Back to markets
          </Link>
        </section>
      </AppLayout>
    );
  }

  return (
    <AppLayout showSearch={false}>
      <section className="mx-4 pt-6 md:mx-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href="/market"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            <ArrowLeft size={18} weight="bold" />
            Markets
          </Link>
        </div>

        {isLoading && <p className="text-sm text-[var(--muted)]">Loading market…</p>}
        {loadError && <p className="text-sm text-red-400">{loadError}</p>}

        {market && (
          <div className="mx-auto max-w-[640px] space-y-5">
            <div className="overflow-hidden rounded-2xl border border-[#2a3243] bg-[#111827] shadow-[0_10px_28px_rgba(2,6,23,0.4)]">
              <div className="h-36 w-full overflow-hidden border-b border-[#212a3a] bg-[#0d1422]">
                {market.imageUrl ? (
                  <img src={market.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">No image</div>
                )}
              </div>
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{market.kind}</p>
                    <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">{market.title}</h1>
                    <p className="mt-1 text-sm text-slate-400">{market.stateLabel}</p>
                  </div>
                  <TrendUp size={28} weight="bold" className="shrink-0 text-[var(--accent)]" />
                </div>
                {market.description ? (
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">{market.description}</p>
                ) : null}

                <dl className="mt-4 grid gap-2 text-sm text-slate-300">
                  <div className="flex justify-between gap-2 border-t border-[#2a3243] pt-3">
                    <dt className="text-slate-500">TVL</dt>
                    <dd className="font-medium text-white">${market.poolTvl}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Stake ends</dt>
                    <dd className="text-right text-white">{market.stakeEnds}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Resolve after</dt>
                    <dd className="text-right text-white">{market.resolveAfter}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Contract</dt>
                    <dd className="break-all font-mono text-[11px] text-slate-400">{market.address}</dd>
                  </div>
                </dl>

                {market.marketState === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setTradeOpen(true);
                      setTradeStatus("");
                    }}
                    className="mt-4 w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-bold text-white shadow-[0_0_20px_rgba(139,92,246,0.25)] transition hover:brightness-110"
                  >
                    Trade
                  </button>
                )}
              </div>
            </div>

            {market.marketState === 2 && (
              <div className="rounded-2xl border border-[#2a3243] bg-[#0f1727] p-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Settlement</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Resolved at</dt>
                    <dd className="text-right text-white">{fmtTsFromUnix(market.settlementTimestamp)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Winning outcome</dt>
                    <dd className="text-right font-medium text-emerald-300">
                      #{market.winningOutcomeIndex ?? "—"}{" "}
                      {market.winningOutcomeIndex != null
                        ? `(${market.outcomeLabels[market.winningOutcomeIndex] ?? `Outcome ${market.winningOutcomeIndex + 1}`})`
                        : ""}
                    </dd>
                  </div>
                  {market.kind === "Price" && (
                    <>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Oracle price (feed)</dt>
                        <dd className="text-right font-mono text-white">
                          {settledPriceHuman != null
                            ? `$${Number(settledPriceHuman).toLocaleString(undefined, { maximumFractionDigits: 6 })}`
                            : "—"}
                        </dd>
                      </div>
                      {market.usesBins ? (
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500">Bins</dt>
                          <dd className="max-w-[60%] text-right text-xs text-slate-300">
                            {market.priceBinByOutcome?.map((b, i) => (
                              <div key={i}>
                                {market.outcomeLabels[i]}: {b}
                              </div>
                            ))}
                          </dd>
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Rule</dt>
                            <dd className="text-right text-white">{priceKindName(market.priceThresholdKind)}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Threshold (8 decimals)</dt>
                            <dd className="text-right font-mono text-white">
                              ${Number(thresholdHuman ?? "0").toLocaleString(undefined, { maximumFractionDigits: 6 })}
                            </dd>
                          </div>
                          {market.priceThresholdKind === 2 && (
                            <div className="flex justify-between gap-2">
                              <dt className="text-slate-500">Upper bound</dt>
                              <dd className="text-right font-mono text-white">
                                ${Number(formatUnits(market.priceUpperBound, 8)).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </dd>
                            </div>
                          )}
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Settlement compare (6dp norm)</dt>
                            <dd className="break-all font-mono text-[11px] text-slate-400">
                              {market.settledOraclePrice > BigInt(0)
                                ? normalizedFromAnswer(market.settledOraclePrice, market.feedDecimals).toString()
                                : "—"}
                            </dd>
                          </div>
                        </>
                      )}
                    </>
                  )}
                  {market.kind === "Event" && umaResultLine && (
                    <div className="rounded-lg border border-[#2a3243] bg-[#111827] p-2 text-xs text-slate-300">
                      {umaResultLine}
                    </div>
                  )}
                  <div className="flex justify-between gap-2 border-t border-[#2a3243] pt-2">
                    <dt className="text-slate-500">Redemption rate (1e18)</dt>
                    <dd className="font-mono text-xs text-slate-300">{formatUnits(market.redemptionRate, 18)}</dd>
                  </div>
                </dl>

                {address &&
                  market.winningOutcomeIndex != null &&
                  shareBalance !== null &&
                  shareBalance > BigInt(0) && (
                    <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                      <p className="text-xs font-semibold text-emerald-200">Redeem winning shares</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Balance: {formatUnits(shareBalance, market.collateralDecimals)} shares
                      </p>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={redeemShares}
                        onChange={(e) => setRedeemShares(e.target.value)}
                        placeholder="Share amount"
                        className="mt-2 w-full rounded-lg border border-[#2a3243] bg-[#111827] px-3 py-2 text-sm text-white outline-none"
                      />
                      {shareAllowance !== null && redeemableWei !== null && (
                        <p className="mt-1 text-[10px] text-slate-500">
                          Allowance: {formatUnits(shareAllowance, market.collateralDecimals)}
                        </p>
                      )}
                      {redeemStatus ? <p className="mt-2 text-xs text-slate-400">{redeemStatus}</p> : null}
                      <button
                        type="button"
                        disabled={redeemBusy}
                        onClick={() => void submitRedeem()}
                        className="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {redeemBusy ? "Working…" : "Redeem"}
                      </button>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}

        {!hasWalletConnectProjectId && (
          <p className="mt-4 text-sm text-red-400">
            Add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env for full wallet support.
          </p>
        )}
      </section>

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
        />
      )}
    </AppLayout>
  );
}

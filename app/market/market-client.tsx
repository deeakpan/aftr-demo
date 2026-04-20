"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise, BookmarkSimple, Gift, TrendUp } from "@phosphor-icons/react";
import { formatUnits, parseAbi, parseUnits, zeroAddress } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { hasWalletConnectProjectId } from "@/app/wagmi-config";
import { AppLayout } from "@/app/components/app-layout";
import { LimitOrderParams, TradeModal } from "@/app/market/components/trade-modal";
import deployment from "@/deployments/baseSepolia-84532.json";

const DEPLOYMENT_CHAIN_ID = deployment.chainId;
const FACTORY_ADDRESS = deployment.contracts.AFTRParimutuelMarketFactory as `0x${string}`;
const ORDERBOOK_ADDRESS = (deployment as unknown as { contracts: Record<string, string> }).contracts.AFTROrderBook as `0x${string}`;
const ORDERBOOK_ABI = parseAbi([
  "function placeSellOrder(address market, address token, uint256 price, uint256 amount) returns (bytes32)",
  "function placeBuyOrder(address market, address token, uint256 price, uint256 amount) payable returns (bytes32)",
]);
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
  slug?: string;
};

type IpfsMetadata = {
  title?: string;
  description?: string;
  image?: string;
  outcomes?: string[];
  slug?: string;
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
  const router = useRouter();
  const publicClient = usePublicClient({ chainId: DEPLOYMENT_CHAIN_ID });
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
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradePriceRaw, setTradePriceRaw] = useState<bigint | null>(null);
  const [collateralBalance, setCollateralBalance] = useState<bigint | null>(null);
  const [collateralAllowance, setCollateralAllowance] = useState<bigint | null>(null);
  const [tradeSlippageBps, setTradeSlippageBps] = useState(200);
  const [outcomeTokenForTrade, setOutcomeTokenForTrade] = useState<`0x${string}` | null>(null);
  /** Bumps on an interval while the trade modal is open so expiry / stake-end disables react to wall clock. */
  const [tradeModalClock, setTradeModalClock] = useState(0);
  /** Bumps on an interval so expired markets disappear from the list without a manual refresh. */
  const [marketListClock, setMarketListClock] = useState(0);

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
            const [kind, uri, stake, resolveAfter, outcomes, state, collateralDecimals] = await Promise.all([
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
            ]);
            const metadataUri = String(uri || "");
            const md = await fetchIpfsMetadata(metadataUri);
            const outcomeCount = Number(outcomes);
            const dec = Number(collateralDecimals);
            const realPoolParts = await Promise.all(
              Array.from({ length: outcomeCount }, (_, i) =>
                publicClient.readContract({
                  address: marketAddress,
                  abi: MARKET_ABI,
                  functionName: "realPool",
                  args: [BigInt(i)],
                }),
              ),
            );
            const poolTvlRaw = realPoolParts.reduce((acc, v) => acc + (v as bigint), BigInt(0));
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
              slug: md?.slug?.trim() || undefined,
              title: md?.title?.trim() || `${isPrice ? "Price" : "Event"} market`,
              description: md?.description?.trim() || "No description provided.",
              imageUrl: ipfsToHttp(md?.image?.trim() || ""),
              stakeEnds: fmtTs(stake as bigint),
              resolveAfter: fmtTs(resolveAfter as bigint),
              stakeEndUnix: Number(stake as bigint),
              resolveAfterUnix: Number(resolveAfter as bigint),
              marketState: Number(state),
              stateLabel: stateLabel(Number(state)),
              poolTvl: Number(formatUnits(poolTvlRaw, dec)).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              }),
              chancePct: leftPct,
              collateralAddress: (await publicClient.readContract({
                address: marketAddress,
                abi: MARKET_ABI,
                functionName: "collateralAddress",
              })) as `0x${string}`,
              collateralDecimals: dec,
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

  const visibleMarkets = useMemo(() => {
    void marketListClock;
    const now = Math.floor(Date.now() / 1000);
    return markets.filter((m) => m.stakeEndUnix > now);
  }, [markets, marketListClock]);

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
      const sharesWei = (amountWei * WAD) / tradePriceRaw;
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

  const submitLimitOrderFromParams = async (params: LimitOrderParams) => {
    if (!selectedMarket || !publicClient || !walletClient || !address) throw new Error("Connect wallet first.");
    if (chainId !== DEPLOYMENT_CHAIN_ID) throw new Error(`Switch to Base Sepolia (${DEPLOYMENT_CHAIN_ID}).`);
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
      const minSharesOut = (estShares * BigInt(10_000 - slipBps)) / BigInt(10000);

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
        {visibleMarkets.length > 0 && (
          <div className="mt-5 grid max-w-[760px] gap-3 md:grid-cols-2">
            {visibleMarkets.map((m) => {
              const chance = Number.isFinite(m?.chancePct) ? m.chancePct : 50;
              return (
                <article
                  key={m.address}
                  className="overflow-hidden rounded-2xl border border-[#2a3243] bg-[#111827] p-0 shadow-[0_10px_28px_rgba(2,6,23,0.4)] transition hover:border-[#3a4761]"
                >
                <div className="aspect-[16/7] w-full overflow-hidden border-b border-[#212a3a] bg-[#0d1422]">
                  {m.imageUrl ? (
                    <img src={m.imageUrl} alt={m.title} className="h-full w-full object-cover object-center" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">
                      No image
                    </div>
                  )}
                </div>

                <div className="p-2.5">
                  <p
                    className="line-clamp-2 cursor-pointer text-base leading-snug font-semibold text-white underline-offset-2 hover:underline"
                    onClick={() => router.push(`/market/${m.address}`)}
                  >
                    {m.title}
                  </p>
                  {m.slug && (
                    <p className="mt-0.5 font-mono text-[10px] text-slate-600">/{m.slug}</p>
                  )}

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

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(m.outcomeLabels ?? []).slice(0, 2).map((label, idx) => (
                      <button
                        key={`${m.address}-${label}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openTrade(m, idx);
                        }}
                        className={`rounded-lg border px-2 py-2 text-center text-sm font-semibold uppercase tracking-wide transition ${
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

                <div className="flex items-center justify-between border-t border-[#212a3a] bg-[#0f1727] px-2.5 py-1.5 text-[11px] text-slate-300">
                  <Tip label="Total Value Locked">
                    <div className="inline-flex items-center gap-1.5 font-semibold">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-[#4f7cff] to-[#6dff8e]" />
                      ${m.poolTvl}
                    </div>
                  </Tip>
                  <div className="flex items-center gap-2">
                    <Tip label="Refresh TVL">
                      <button type="button" onClick={(e) => { e.stopPropagation(); void refreshTvl(m); }}
                        className="inline-flex items-center transition hover:text-white">
                        <ArrowsClockwise size={12} className={tvlRefreshing[m.address] ? "animate-spin" : ""} />
                      </button>
                    </Tip>
                    <Tip label="Resolves after">
                      <span className="inline-flex items-center gap-0.5"><Gift size={12} /> {m.resolveAfter}</span>
                    </Tip>
                    <BookmarkSimple size={12} />
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
        onSubmitLimit={submitLimitOrderFromParams}
      />
    </AppLayout>
  );
}

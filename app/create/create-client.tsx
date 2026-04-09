"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CaretDown } from "@phosphor-icons/react";
import { decodeEventLog, formatUnits, keccak256, parseAbi, parseUnits, stringToHex, toBytes } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import { MarketPreviewModal } from "@/app/create/components/market-preview-modal";
import deployment from "@/deployments/baseSepolia-84532.json";

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]";

const labelClass = "text-xs font-medium uppercase tracking-wider text-[var(--muted)]";

const FEEDS = [
  { label: "BTC/USD", asset: "BTC", logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png", address: "0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298" },
  { label: "CBETH/ETH", asset: "cbETH", logo: "https://assets.coingecko.com/coins/images/27008/large/cbeth.png", address: "0x91b21900E91CD302EBeD05E45D8f270ddAED944d" },
  { label: "CBETH/USD", asset: "cbETH", logo: "https://assets.coingecko.com/coins/images/27008/large/cbeth.png", address: "0x3c65e28D357a37589e1C7C86044a9f44dDC17134" },
  { label: "DAI/USD", asset: "DAI", logo: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png", address: "0xD1092a65338d049DB68D7Be6bD89d17a0929945e" },
  { label: "ETH/USD", asset: "ETH", logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png", address: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1" },
  { label: "LINK/ETH", asset: "LINK", logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png", address: "0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69" },
  { label: "LINK/USD", asset: "LINK", logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png", address: "0xb113F5A928BCfF189C998ab20d753a47F9dE5A61" },
  { label: "USDC/USD", asset: "USDC", logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png", address: "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165" },
] as const;
type Feed = (typeof FEEDS)[number];

const CATEGORIES = [
  "Crypto",
  "Politics",
  "Finance",
  "Tech",
  "Economy",
  "Sports",
  "Gaming",
  "Culture",
] as const;

const CHAINLINK_ABI = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
]);
const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const FACTORY_ABI = parseAbi([
  "function createEventMarket((address collateralToken,uint8 collateralDecimals,uint256 virtualReserve,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,string metadataURI,string umaAncillary,bytes32 umaIdentifier,uint64 umaLiveness,uint256 umaProposerBond,uint256 umaReward,address umaRewardCurrency,uint256 minBootstrapTotal) p) returns (address market)",
  "function createPriceMarket((address collateralToken,uint8 collateralDecimals,uint256 virtualReserve,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,address chainlinkFeed,uint256 priceThreshold,uint8 priceKind,uint256 priceUpperBound,uint256 maxPriceStaleness,uint256[] priceBinLower,uint256[] priceBinUpper,uint256 minBootstrapTotal) p) returns (address market)",
  "event MarketCreated(address indexed market, uint8 indexed kind, address indexed collateralToken, address[] outcomeTokens, string[] outcomeLabels, uint256 stakeEndTimestamp, uint256 resolveAfterTimestamp, bytes32 metadataHash)",
]);
const MARKET_ABI = parseAbi([
  "function bootstrapLiquidity(uint256 totalAmount, address shareRecipient) payable",
  "function bootstrapped() view returns (bool)",
  "function numOutcomes() view returns (uint8)",
]);

const AFTR_USDC_BASE_SEPOLIA = deployment.contracts.AFTRUSDC as `0x${string}`;
const FACTORY_ADDRESS = deployment.contracts.AFTRParimutuelMarketFactory as `0x${string}`;
const DEFAULT_UMA_REWARD = BigInt(deployment.suggestedUmaReward ?? "0");
const DEFAULT_UMA_REWARD_CURRENCY = deployment.external.umaBondCurrencyCircleUSDC as `0x${string}`;
const DEPLOYMENT_CHAIN_ID = deployment.chainId;

function numString(idx: number) {
  return String(idx);
}

function formatUsdcDisplay(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseLocalDateTimeToMs(input: string): number {
  // datetime-local gives YYYY-MM-DDTHH:mm; parse explicitly to avoid locale/browser quirks.
  const m = input.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    0,
    0,
  ).getTime();
}

export function CreateClient() {
  const publicClient = usePublicClient({ chainId: DEPLOYMENT_CHAIN_ID });
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [marketKind, setMarketKind] = useState<"event" | "price">("event");
  const [eventMode, setEventMode] = useState<"binary" | "multiple">("binary");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [outcomes, setOutcomes] = useState(["Yes", "No"]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [feed, setFeed] = useState<Feed>(FEEDS[0]);
  const [comparison, setComparison] = useState<"ABOVE" | "BELOW">("ABOVE");
  const [threshold, setThreshold] = useState("");
  const [currentPriceLabel, setCurrentPriceLabel] = useState("—");
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);
  const [imageUri, setImageUri] = useState("");
  const [metadataUri, setMetadataUri] = useState("");
  const [uploadState, setUploadState] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [seedAmount, setSeedAmount] = useState("40");
  const [stakeEndAt, setStakeEndAt] = useState("");
  const [resolveAfterAt, setResolveAfterAt] = useState("");
  const [step, setStep] = useState<"details" | "seed">("details");
  const [isNextLoading, setIsNextLoading] = useState(false);
  const [isAssetDropdownOpen, setIsAssetDropdownOpen] = useState(false);
  const [isAncillaryOpen, setIsAncillaryOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [seedValidationError, setSeedValidationError] = useState("");
  const [previewImageSrc, setPreviewImageSrc] = useState("");
  const assetDropdownRef = useRef<HTMLDivElement>(null);
  const [brokenLogoAddresses, setBrokenLogoAddresses] = useState<string[]>([]);
  const [timeValidationError, setTimeValidationError] = useState("");
  const [usdcBalanceLabel, setUsdcBalanceLabel] = useState("0.00");
  const [isSubmittingMarket, setIsSubmittingMarket] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [createdMarketAddress, setCreatedMarketAddress] = useState("");
  const [isCreateComplete, setIsCreateComplete] = useState(false);

  useEffect(() => {
    if (eventMode === "binary") {
      setOutcomes(["Yes", "No"]);
    } else if (outcomes.length < 3) {
      setOutcomes(["Option 1", "Option 2", "Option 3"]);
    }
  }, [eventMode, outcomes.length]);

  useEffect(() => {
    const readUsdcBalance = async () => {
      if (!publicClient || !address) {
        setUsdcBalanceLabel("0.00");
        return;
      }
      try {
        const [rawBalance, decimals] = await Promise.all([
          publicClient.readContract({
            address: AFTR_USDC_BASE_SEPOLIA,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
          publicClient.readContract({
            address: AFTR_USDC_BASE_SEPOLIA,
            abi: ERC20_ABI,
            functionName: "decimals",
          }),
        ]);
        const value = Number(formatUnits(rawBalance, decimals));
        setUsdcBalanceLabel(formatUsdcDisplay(value));
      } catch {
        setUsdcBalanceLabel("0.00");
      }
    };
    void readUsdcBalance();
  }, [address, publicClient]);

  useEffect(() => {
    if (imageFile) {
      const objectUrl = URL.createObjectURL(imageFile);
      setPreviewImageSrc(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (imageUri) {
      const cid = imageUri.replace("ipfs://", "");
      setPreviewImageSrc(`https://gateway.lighthouse.storage/ipfs/${cid}`);
      return;
    }
    setPreviewImageSrc("");
  }, [imageFile, imageUri]);

  useEffect(() => {
    const run = async () => {
      if (!publicClient || marketKind !== "price") return;
      setIsFetchingPrice(true);
      try {
        const [round, decimals] = await Promise.all([
          publicClient.readContract({
            address: feed.address,
            abi: CHAINLINK_ABI,
            functionName: "latestRoundData",
          }),
          publicClient.readContract({
            address: feed.address,
            abi: CHAINLINK_ABI,
            functionName: "decimals",
          }),
        ]);
        const answer = Number(formatUnits(round[1], decimals));
        const normalized = Number.isFinite(answer) ? answer : 0;
        const str = normalized.toLocaleString(undefined, { maximumFractionDigits: 8 });
        setCurrentPriceLabel(str);
        const nextThreshold = normalized * 1.01;
        setThreshold(
          nextThreshold.toLocaleString(undefined, {
            maximumFractionDigits: 8,
          }),
        );
      } catch {
        setCurrentPriceLabel("N/A");
      } finally {
        setIsFetchingPrice(false);
      }
    };
    void run();
  }, [feed, marketKind, publicClient]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!assetDropdownRef.current) return;
      if (!assetDropdownRef.current.contains(event.target as Node)) {
        setIsAssetDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const resolveUtcLabel = useMemo(() => {
    if (!resolveAfterAt) return "the specified resolve time (UTC)";
    const d = new Date(resolveAfterAt);
    if (Number.isNaN(d.getTime())) return "the specified resolve time (UTC)";
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }, [resolveAfterAt]);

  const generatedPricePrompt = useMemo(() => {
    if (marketKind !== "price") return "";
    const dir = comparison === "ABOVE" ? "above" : "below";
    const t = threshold || "the selected threshold";
    return `Will ${feed.asset} settle ${dir} ${t} at ${resolveUtcLabel}?`;
  }, [comparison, feed.asset, marketKind, resolveUtcLabel, threshold]);

  const effectiveTitle = useMemo(
    () => (marketKind === "price" ? generatedPricePrompt : title),
    [generatedPricePrompt, marketKind, title],
  );

  const umaAncillary = useMemo(() => {
    if (marketKind !== "event") return "";
    if (eventMode === "binary") {
      const payload = [title, description].filter(Boolean).join("\n").trim();
      return `${payload}\n\nAnswer only YES or NO.`;
    }
    const payload = {
      title: title || "Multiple choice market",
      description: description || "Resolve to the correct option.",
      options: outcomes.map((label, idx) => [label, numString(idx)]),
    };
    return JSON.stringify(payload);
  }, [description, eventMode, marketKind, outcomes, title]);
  const resolvedPriceTitle = useMemo(() => {
    if (marketKind !== "price") return title;
    return generatedPricePrompt;
  }, [generatedPricePrompt, marketKind, title]);
  const minDateTimeLocal = useMemo(() => {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }, []);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  };

  const onChangeOutcome = (idx: number, value: string) => {
    setOutcomes((prev) => prev.map((item, i) => (i === idx ? value : item)));
  };

  const addOutcome = () => {
    setOutcomes((prev) => [...prev, `Option ${prev.length + 1}`]);
  };

  const openPreview = () => {
    const seed = Number(seedAmount);
    if (!Number.isFinite(seed) || seed < 40) {
      setSeedValidationError("Seed liquidity must be at least 40 USDC.");
      return;
    }
    setSeedValidationError("");
    setIsCreateComplete(false);
    setIsPreviewOpen(true);
  };

  const handleCreateMarket = async () => {
    if (!address || !publicClient || !walletClient) {
      setSubmitStatus("Connect wallet first.");
      return;
    }
    if (chainId !== DEPLOYMENT_CHAIN_ID) {
      setSubmitStatus(`Switch wallet network to Base Sepolia (${DEPLOYMENT_CHAIN_ID}).`);
      return;
    }

    const cleanedThreshold = threshold.replaceAll(",", "").trim();
    const cleanOutcomes =
      marketKind === "event"
        ? (eventMode === "binary" ? ["Yes", "No"] : outcomes.map((o) => o.trim()).filter(Boolean))
        : ["YES", "NO"];
    if (cleanOutcomes.length < 2) {
      setSubmitStatus("Add at least 2 outcomes.");
      return;
    }

    try {
      setIsSubmittingMarket(true);
      setSubmitStatus("Preparing transaction...");
      setCreatedMarketAddress("");
      setIsCreateComplete(false);

      const seedUnits = parseUnits(seedAmount || "0", 6);
      if (seedUnits < parseUnits("40", 6)) {
        setSubmitStatus("Seed liquidity must be at least 40 USDC.");
        return;
      }

      const stakeTs = BigInt(Math.floor(parseLocalDateTimeToMs(stakeEndAt) / 1000));
      const resolveTs = BigInt(Math.floor(parseLocalDateTimeToMs(resolveAfterAt) / 1000));
      const metadataHash = keccak256(toBytes(metadataUri || "ipfs://pending"));
      const virtualReserve = parseUnits(seedAmount || "40", 6);
      const minBootstrapTotal = parseUnits("40", 6);

      setSubmitStatus("Creating market...");
      const createHash =
        marketKind === "event"
          ? await walletClient.writeContract({
              chain: walletClient.chain,
              address: FACTORY_ADDRESS,
              abi: FACTORY_ABI,
              functionName: "createEventMarket",
              args: [
                {
                  collateralToken: AFTR_USDC_BASE_SEPOLIA,
                  collateralDecimals: 6,
                  virtualReserve,
                  stakeEndTimestamp: stakeTs,
                  resolveAfterTimestamp: resolveTs,
                  metadataHash,
                  outcomeLabels: cleanOutcomes,
                  metadataURI: metadataUri,
                  umaAncillary,
                  umaIdentifier: stringToHex("", { size: 32 }),
                  umaLiveness: BigInt(7200),
                  umaProposerBond: BigInt(0),
                  umaReward: DEFAULT_UMA_REWARD,
                  umaRewardCurrency: DEFAULT_UMA_REWARD_CURRENCY,
                  minBootstrapTotal,
                },
              ],
              account: address,
            })
          : await walletClient.writeContract({
              chain: walletClient.chain,
              address: FACTORY_ADDRESS,
              abi: FACTORY_ABI,
              functionName: "createPriceMarket",
              args: [
                {
                  collateralToken: AFTR_USDC_BASE_SEPOLIA,
                  collateralDecimals: 6,
                  virtualReserve,
                  stakeEndTimestamp: stakeTs,
                  resolveAfterTimestamp: resolveTs,
                  metadataHash,
                  outcomeLabels: cleanOutcomes,
                  chainlinkFeed: feed.address,
                  priceThreshold: parseUnits(cleanedThreshold || "0", 8),
                  priceKind: comparison === "ABOVE" ? 0 : 1,
                  priceUpperBound: BigInt(0),
                  maxPriceStaleness: BigInt(3600),
                  priceBinLower: [],
                  priceBinUpper: [],
                  minBootstrapTotal,
                },
              ],
              account: address,
            });

      const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
      let createdMarket = "";
      for (const log of createReceipt.logs) {
        if (log.address.toLowerCase() !== FACTORY_ADDRESS.toLowerCase()) continue;
        try {
          const parsed = decodeEventLog({
            abi: FACTORY_ABI,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          if (parsed.eventName === "MarketCreated") {
            const market = (parsed.args.market ?? "") as string;
            createdMarket = market;
            setCreatedMarketAddress(market);
            break;
          }
        } catch {
          // ignore unrelated logs
        }
      }

      if (!createdMarket) {
        setSubmitStatus("Market created tx confirmed, but market address could not be parsed from factory logs.");
        return;
      }

      const marketCode = await publicClient.getCode({ address: createdMarket as `0x${string}` });
      if (!marketCode || marketCode === "0x") {
        setSubmitStatus("Market address was emitted but no bytecode found at that address.");
        return;
      }

      setSubmitStatus("Checking market allowance...");
      const alreadyBootstrapped = (await publicClient.readContract({
        address: createdMarket as `0x${string}`,
        abi: MARKET_ABI,
        functionName: "bootstrapped",
      })) as boolean;
      if (alreadyBootstrapped) {
        setSubmitStatus("Market created, but liquidity was already seeded by another wallet.");
        return;
      }

      const nOutcomes = Number(
        (await publicClient.readContract({
          address: createdMarket as `0x${string}`,
          abi: MARKET_ABI,
          functionName: "numOutcomes",
        })) as number,
      );
      if (nOutcomes > 0 && seedUnits % BigInt(nOutcomes) !== BigInt(0)) {
        setSubmitStatus(`Seed amount must be divisible by ${nOutcomes} outcomes.`);
        return;
      }

      const marketAllowance = (await publicClient.readContract({
        address: AFTR_USDC_BASE_SEPOLIA,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, createdMarket as `0x${string}`],
      })) as bigint;

      if (marketAllowance < seedUnits) {
        setSubmitStatus("Approve USDC to seed liquidity...");
        const approveHash = await walletClient.writeContract({
          chain: walletClient.chain,
          address: AFTR_USDC_BASE_SEPOLIA,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [createdMarket as `0x${string}`, seedUnits],
          account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setSubmitStatus("Seeding liquidity...");
      const bootstrapHash = await walletClient.writeContract({
        chain: walletClient.chain,
        address: createdMarket as `0x${string}`,
        abi: MARKET_ABI,
        functionName: "bootstrapLiquidity",
        args: [seedUnits, address],
        account: address,
        gas: BigInt(800_000),
      });
      await publicClient.waitForTransactionReceipt({ hash: bootstrapHash });

      setSubmitStatus("Market created and liquidity seeded successfully.");
      setIsCreateComplete(true);
      void (async () => {
        try {
          const [rawBalance, decimals] = await Promise.all([
            publicClient.readContract({
              address: AFTR_USDC_BASE_SEPOLIA,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [address],
            }),
            publicClient.readContract({
              address: AFTR_USDC_BASE_SEPOLIA,
              abi: ERC20_ABI,
              functionName: "decimals",
            }),
          ]);
          const value = Number(formatUnits(rawBalance as bigint, decimals as number));
          setUsdcBalanceLabel(formatUsdcDisplay(value));
        } catch {
          // no-op
        }
      })();
    } catch (error) {
      setSubmitStatus(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setIsSubmittingMarket(false);
    }
  };

  const removeOutcome = (idx: number) => {
    setOutcomes((prev) => prev.filter((_, i) => i !== idx));
  };

  const uploadImage = async (file: File) => {
    const fd = new FormData();
    fd.append("kind", "file");
    fd.append("file", file);
    const res = await fetch("/api/lighthouse/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Image upload failed");
    const uploadedImageUri = String(data.ipfsUri ?? "");
    setImageUri(uploadedImageUri);
    return uploadedImageUri;
  };

  const uploadMetadata = async (imageUriForMetadata?: string) => {
    const imageToUse = imageUriForMetadata || imageUri;
    if (!imageToUse) {
      throw new Error("Upload a cover image first so metadata includes image IPFS URI.");
    }
    const metadata = {
      title: effectiveTitle,
      description,
      marketKind,
      eventMode: marketKind === "event" ? eventMode : null,
      question: marketKind === "price" ? generatedPricePrompt : title,
      categories: selectedCategories,
      outcomes,
      image: imageToUse || null,
      priceConfig:
        marketKind === "price"
          ? {
              feed: feed.label,
              feedAddress: feed.address,
              currentPrice: currentPriceLabel,
              comparison,
              threshold,
              generatedPrompt: generatedPricePrompt,
            }
          : null,
      umaAncillary: marketKind === "event" ? umaAncillary : null,
    };
    const fd = new FormData();
    fd.append("kind", "json");
    fd.append("filename", "market-metadata.json");
    fd.append("json", JSON.stringify(metadata, null, 2));
    const res = await fetch("/api/lighthouse/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Metadata upload failed");
    setMetadataUri(data.ipfsUri);
  };

  const goToSeedStep = async () => {
    // Match datetime-local minute precision (seconds are not user-editable).
    const nowMinuteTs = Math.floor(Date.now() / 60_000) * 60_000;
    const minTs = nowMinuteTs + 5 * 60 * 1000;
    const stakeTs = stakeEndAt ? parseLocalDateTimeToMs(stakeEndAt) : 0;
    const resolveTs = resolveAfterAt ? parseLocalDateTimeToMs(resolveAfterAt) : 0;
    if (!stakeTs || !resolveTs || Number.isNaN(stakeTs) || Number.isNaN(resolveTs)) {
      setTimeValidationError("Set both stake end and resolve after times.");
      return;
    }
    if (stakeTs < minTs || resolveTs < minTs) {
      setTimeValidationError("Stake end and resolve after must each be at least 5 minutes in the future.");
      return;
    }
    if (resolveTs <= stakeTs) {
      setTimeValidationError("Resolve after must be later than stake end.");
      return;
    }
    setTimeValidationError("");

    if (!imageFile) {
      setUploadState("Please choose a cover image first.");
      return;
    }
    setIsNextLoading(true);
    setUploadState("");
    try {
      const uploadedImageUri = await uploadImage(imageFile);
      await uploadMetadata(uploadedImageUri);
      setStep("seed");
    } catch (err) {
      setUploadState(err instanceof Error ? err.message : "Could not prepare metadata.");
    } finally {
      setIsNextLoading(false);
    }
  };

  return (
    <AppLayout searchPlaceholder="Search markets... (Ctrl/Cmd + K)" showSearch={false}>
      <div className="mx-auto max-w-3xl px-3 pb-14 md:px-6 md:pb-16">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)] md:mb-8 md:text-sm"
        >
          <ArrowLeft size={18} weight="bold" />
          Back to markets
        </Link>

        <div className="mb-7 md:mb-10">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)] md:text-3xl">
              Create market
            </h1>
            <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-[var(--muted)] md:mt-2 md:text-sm">
              Define resolution rules and metadata. On-chain creation via the factory will plug in here next.
            </p>
          </div>
        </div>

        <div className="space-y-0 divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {step === "details" ? (
            <>
          <section className="py-8">
            <p className={labelClass}>Market type</p>
            <div className="mt-4 inline-flex rounded-full bg-[var(--surface)] p-1">
              {(
                [
                  { id: "event" as const, label: "Event (UMA)" },
                  { id: "price" as const, label: "Price (oracle)" },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMarketKind(id)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    marketKind === id
                      ? "bg-[var(--accent)] text-white shadow-sm"
                      : "text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {marketKind === "event" ? (
            <section className="py-8">
              <label className={labelClass} htmlFor="title">
                Title
              </label>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={fieldClass}
                placeholder="Short market title"
              />
            </section>
          ) : (
            <section className="py-8">
              <label className={labelClass}>Generated title</label>
              <div className="mt-2 space-y-2">
                <p className={`${fieldClass} leading-relaxed`}>{resolvedPriceTitle || "—"}</p>
                <p className="text-xs text-[var(--muted)]">
                  This is auto-generated from selected asset, condition, threshold and resolve time (UTC).
                </p>
              </div>
            </section>
          )}

          <section className="py-8">
            <label className={labelClass} htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${fieldClass} min-h-24 resize-y`}
              placeholder="Add a clear resolution description"
            />
          </section>

          {marketKind === "event" && (
            <section className="py-8">
              <p className={labelClass}>Event mode</p>
              <div className="mt-4 inline-flex rounded-full bg-[var(--surface)] p-1">
                {(
                  [
                    { id: "binary" as const, label: "Binary" },
                    { id: "multiple" as const, label: "Multiple choice" },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setEventMode(id)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      eventMode === id
                        ? "bg-[var(--accent)] text-white shadow-sm"
                        : "text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {marketKind === "price" ? (
            <>
              <section className="py-8">
                <label className={labelClass}>Asset</label>
                <div ref={assetDropdownRef} className="relative mt-2">
                  <button
                    type="button"
                    onClick={() => setIsAssetDropdownOpen((v) => !v)}
                    className="flex w-full max-w-[300px] items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left text-sm text-[var(--foreground)] md:max-w-[360px] md:px-4 md:py-3"
                  >
                    <span className="inline-flex items-center gap-3">
                      {brokenLogoAddresses.includes(feed.address) ? (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[9px] font-semibold text-[var(--muted)]">
                          {feed.asset.slice(0, 2).toUpperCase()}
                        </span>
                      ) : (
                        <img
                          src={feed.logo}
                          alt={feed.asset}
                          onError={() =>
                            setBrokenLogoAddresses((prev) =>
                              prev.includes(feed.address) ? prev : [...prev, feed.address],
                            )
                          }
                          className="h-5 w-5 rounded-full bg-white/10 object-cover"
                        />
                      )}
                      <span>
                        {feed.asset}
                        <span className="ml-2 text-xs text-[var(--muted)]">{feed.label}</span>
                      </span>
                    </span>
                    <CaretDown size={16} weight="bold" className="text-[var(--muted)]" />
                  </button>
                  {isAssetDropdownOpen && (
                    <div className="absolute z-30 mt-2 max-h-64 w-full max-w-[300px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl md:max-w-[360px]">
                      {FEEDS.map((f) => (
                        <button
                          key={f.address}
                          type="button"
                          onClick={() => {
                            setFeed(f);
                            setIsAssetDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-hover)] ${
                            f.address === feed.address ? "bg-[var(--surface)]" : ""
                          }`}
                        >
                          {brokenLogoAddresses.includes(f.address) ? (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[9px] font-semibold text-[var(--muted)]">
                              {f.asset.slice(0, 2).toUpperCase()}
                            </span>
                          ) : (
                            <img
                              src={f.logo}
                              alt={f.asset}
                              onError={() =>
                                setBrokenLogoAddresses((prev) =>
                                  prev.includes(f.address) ? prev : [...prev, f.address],
                                )
                              }
                              className="h-5 w-5 rounded-full bg-white/10 object-cover"
                            />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-[var(--foreground)]">{f.asset}</span>
                            <span className="block truncate text-xs text-[var(--muted)]">{f.label}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
              <section className="py-6">
                <p className="text-xs text-[var(--muted)]">
                  Current: {isFetchingPrice ? "Fetching..." : currentPriceLabel}
                </p>
              </section>
              <section className="grid gap-8 py-8 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="comparison">
                    Condition
                  </label>
                  <select
                    id="comparison"
                    className={fieldClass}
                    value={comparison}
                    onChange={(e) => setComparison(e.target.value as "ABOVE" | "BELOW")}
                  >
                    <option value="ABOVE">Greater than (ABOVE)</option>
                    <option value="BELOW">Less than (BELOW)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="threshold">
                    Threshold
                  </label>
                  <input
                    id="threshold"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className={fieldClass}
                    placeholder="Editable threshold"
                  />
                </div>
              </section>
              <section className="py-6">
                <p className="text-xs text-[var(--muted)]">
                  Prompt is generated automatically for price markets.
                </p>
              </section>
            </>
          ) : (
            <>
              {eventMode === "multiple" && (
                <section className="py-8">
                  <label className={labelClass}>Options</label>
                  <div className="mt-3 space-y-3">
                    {outcomes.map((option, idx) => (
                      <div
                        key={`${idx}-${option}`}
                        className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2"
                      >
                        <span className="w-8 shrink-0 text-center text-xs font-semibold text-[var(--muted)]">
                          {idx + 1}
                        </span>
                        <input
                          className="w-full border-0 bg-transparent px-2 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
                          value={option}
                          onChange={(e) => onChangeOutcome(idx, e.target.value)}
                          placeholder={`Option ${idx + 1}`}
                        />
                        {outcomes.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeOutcome(idx)}
                            className="h-8 w-8 shrink-0 rounded-lg border border-[var(--border)] text-lg leading-none text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
                            aria-label={`Remove option ${idx + 1}`}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addOutcome}
                    className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    Add option
                  </button>
                </section>
              )}
            </>
          )}

          <section className="py-8">
            <label className={labelClass}>Categories</label>
            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORIES.map((category) => {
                const active = selectedCategories.includes(category);
                return (
                  <button
                    type="button"
                    key={category}
                    onClick={() => toggleCategory(category)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 py-8 sm:grid-cols-2 sm:gap-6">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:border-0 sm:bg-transparent sm:p-0">
              <label className={labelClass} htmlFor="stake-end">
                Stake ends
              </label>
              <input
                id="stake-end"
                type="datetime-local"
                value={stakeEndAt}
                onChange={(e) => setStakeEndAt(e.target.value)}
                min={minDateTimeLocal}
                className={`${fieldClass} mt-2 h-11 py-2.5 text-sm sm:h-auto sm:py-3`}
              />
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:border-0 sm:bg-transparent sm:p-0">
              <label className={labelClass} htmlFor="resolve-after">
                Resolve after
              </label>
              <input
                id="resolve-after"
                type="datetime-local"
                value={resolveAfterAt}
                onChange={(e) => setResolveAfterAt(e.target.value)}
                min={minDateTimeLocal}
                className={`${fieldClass} mt-2 h-11 py-2.5 text-sm sm:h-auto sm:py-3`}
              />
            </div>
          </section>

          <section className="py-8">
            <label className={labelClass} htmlFor="image">
              Cover image
            </label>
            <input
              id="image"
              type="file"
              accept="image/*"
              className={fieldClass}
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            />
            {imageFile && <p className="mt-3 text-xs text-[var(--muted)]">{imageFile.name}</p>}
          </section>

          <section className="py-10">
            <button
              type="button"
              onClick={goToSeedStep}
              disabled={isNextLoading}
              className="mt-6 w-full rounded-full bg-[var(--accent)] py-3.5 text-sm font-semibold text-white transition hover:opacity-90 sm:w-auto sm:px-10"
            >
              {isNextLoading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                  Preparing...
                </span>
              ) : (
                "Next"
              )}
            </button>
            {timeValidationError && (
              <p className="mt-3 text-xs text-red-400">{timeValidationError}</p>
            )}
            {uploadState && <p className="mt-3 text-xs text-[var(--muted)]">{uploadState}</p>}
          </section>
            </>
          ) : (
            <section className="py-10">
              <label className={labelClass} htmlFor="seed-amount">
                Seed liquidity (USDC)
              </label>
              <input
                id="seed-amount"
                type="number"
                min={40}
                step="0.01"
                value={seedAmount}
                onChange={(e) => setSeedAmount(e.target.value)}
                className={fieldClass}
                placeholder="Minimum 40 USDC"
              />
              <p className="mt-2 text-xs text-[var(--muted)]">
                Wallet balance: {usdcBalanceLabel} USDC
              </p>
              {marketKind === "event" && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setIsAncillaryOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)]"
                  >
                    <CaretDown
                      size={14}
                      weight="bold"
                      className={`transition ${isAncillaryOpen ? "rotate-180" : ""}`}
                    />
                    Ancillary data
                  </button>
                  {isAncillaryOpen && (
                    <pre className="mt-2 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[11px] leading-relaxed text-[var(--muted)]">
                      {umaAncillary}
                    </pre>
                  )}
                </div>
              )}
              <p className="mt-3 text-xs text-[var(--muted)]">
                Seed-liquidity funder receives 0.5% of losing-side collateral at settlement.
              </p>
              <p className="mt-1 text-xs text-[var(--accent)]">Learn more</p>
              <button
                type="button"
                onClick={openPreview}
                className="mt-6 w-full rounded-full border border-[var(--border)] bg-[var(--surface)] py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] sm:w-auto sm:px-8"
              >
                Preview
              </button>
              {seedValidationError && (
                <p className="mt-3 text-xs text-red-400">{seedValidationError}</p>
              )}
            </section>
          )}
        </div>
      </div>
      <MarketPreviewModal
        isOpen={isPreviewOpen}
        marketKind={marketKind}
        eventMode={eventMode}
        previewImageSrc={previewImageSrc}
        effectiveTitle={effectiveTitle}
        description={description}
        selectedCategories={selectedCategories}
        stakeEndAt={stakeEndAt}
        resolveAfterAt={resolveAfterAt}
        seedAmount={seedAmount}
        umaAncillary={umaAncillary}
        metadataUri={metadataUri}
        isSubmittingMarket={isSubmittingMarket}
        submitStatus={submitStatus}
        createdMarketAddress={createdMarketAddress}
        isCreateComplete={isCreateComplete}
        onBack={() => setIsPreviewOpen(false)}
        onCreateMarket={handleCreateMarket}
      />
    </AppLayout>
  );
}

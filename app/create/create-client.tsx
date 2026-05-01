"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CaretDown } from "@phosphor-icons/react";
import {
  decodeEventLog,
  formatUnits,
  isAddress,
  keccak256,
  parseAbi,
  parseUnits,
  stringToHex,
  toBytes,
  zeroAddress,
} from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import { MarketPreviewModal } from "@/app/create/components/market-preview-modal";
import deployment from "@/deployments/baseSepolia-84532.json";

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]";

const labelClass = "text-xs font-medium uppercase tracking-wider text-[var(--muted)]";

/** Bootstrap splits `totalAmount` evenly per outcome; contract requires `totalAmount % numOutcomes == 0` in token base units. */
function nextDivisibleTotal(seedUnits: bigint, nOutcomes: number): bigint {
  if (nOutcomes <= 0) return seedUnits;
  const n = BigInt(nOutcomes);
  const rem = seedUnits % n;
  if (rem === BigInt(0)) return seedUnits;
  return seedUnits + (n - rem);
}

type Feed = {
  label: string;
  asset: string;
  logo: string;
  address: `0x${string}`;
};
const DEFAULT_FEED: Feed = {
  label: "ETH/USD",
  asset: "ETH",
  logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  address: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
};
const FEEDS =
  (deployment as unknown as { external?: { chainlinkFeeds?: Feed[] } }).external?.chainlinkFeeds ??
  [DEFAULT_FEED];

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
  "function createPriceMarket((address collateralToken,uint8 collateralDecimals,uint256 virtualReserve,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,string metadataURI,address chainlinkFeed,uint256 priceThreshold,uint8 priceKind,uint256 priceUpperBound,uint256 maxPriceStaleness,uint256[] priceBinLower,uint256[] priceBinUpper,uint256 minBootstrapTotal) p) returns (address market)",
  "event MarketCreated(address indexed market, uint8 indexed kind, address indexed collateralToken, address[] outcomeTokens, string[] outcomeLabels, uint256 stakeEndTimestamp, uint256 resolveAfterTimestamp, bytes32 metadataHash)",
]);
const MARKET_ABI = parseAbi([
  "function bootstrapLiquidity(uint256 totalAmount, address shareRecipient) payable",
  "function bootstrapped() view returns (bool)",
  "function numOutcomes() view returns (uint8)",
]);

const CIRCLE_USDC_BASE_SEPOLIA = deployment.external.umaBondCurrencyCircleUSDC as `0x${string}`;
const FACTORY_ADDRESS = deployment.contracts.AFTRParimutuelMarketFactory as `0x${string}`;
const DEFAULT_UMA_REWARD = BigInt(deployment.suggestedUmaReward ?? "0");
const DEFAULT_UMA_REWARD_CURRENCY = deployment.external.umaBondCurrencyCircleUSDC as `0x${string}`;
const DEPLOYMENT_CHAIN_ID = deployment.chainId;

type CollateralOption = {
  id: "eth" | "usdc" | "usdead" | "aftr_usdc";
  label: string;
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  image: string;
  isNative?: boolean;
};

function buildCollateralOptions(): CollateralOption[] {
  const c = deployment.contracts as Record<string, string>;
  const circle = CIRCLE_USDC_BASE_SEPOLIA;
  const aftrAddr = (c.AFTRUSDC || "").trim() as `0x${string}`;
  const usdeadAddr = (c.USDeAD || "").trim() as `0x${string}`;
  const list: CollateralOption[] = [
    {
      id: "eth",
      label: "Ethereum",
      symbol: "ETH",
      address: zeroAddress,
      decimals: 18,
      image: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
      isNative: true,
    },
    {
      id: "usdc",
      label: "USD Coin",
      symbol: "USDC",
      address: circle,
      decimals: 6,
      image: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    },
  ];
  if (
    isAddress(aftrAddr, { strict: false }) &&
    aftrAddr.toLowerCase() !== circle.toLowerCase()
  ) {
    list.push({
      id: "aftr_usdc",
      label: "AFTR test USDC",
      symbol: "AFTR USDC",
      address: aftrAddr,
      decimals: 6,
      image: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    });
  }
  if (isAddress(usdeadAddr, { strict: false })) {
    list.push({
      id: "usdead",
      label: "USDeAD",
      symbol: "USDeAD",
      address: usdeadAddr,
      decimals: 18,
      image: "/usdead.jpg",
    });
  }
  return list;
}

const COLLATERAL_OPTIONS = buildCollateralOptions();

const defaultCollateralOpt =
  COLLATERAL_OPTIONS.find((o) => o.id === "usdead") ?? COLLATERAL_OPTIONS[0];

function numString(idx: number) {
  return String(idx);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
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
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [imageUri, setImageUri] = useState("");
  const [metadataUri, setMetadataUri] = useState("");
  const [uploadState, setUploadState] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [seedAmount, setSeedAmount] = useState("10");
  const [stakeEndAt, setStakeEndAt] = useState("");
  const [resolveAfterAt, setResolveAfterAt] = useState("");
  const [step, setStep] = useState<"details" | "seed">("details");
  const [isNextLoading, setIsNextLoading] = useState(false);
  const [isAssetDropdownOpen, setIsAssetDropdownOpen] = useState(false);
  const [isCollateralDropdownOpen, setIsCollateralDropdownOpen] = useState(false);
  const [isAncillaryOpen, setIsAncillaryOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [seedValidationError, setSeedValidationError] = useState("");
  const [previewImageSrc, setPreviewImageSrc] = useState("");
  const assetDropdownRef = useRef<HTMLDivElement>(null);
  const collateralDropdownRef = useRef<HTMLDivElement>(null);
  const [brokenLogoAddresses, setBrokenLogoAddresses] = useState<string[]>([]);
  const [timeValidationError, setTimeValidationError] = useState("");
  const [collateral, setCollateral] = useState<CollateralOption>(defaultCollateralOpt!);
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null);
  const [collateralBalanceLabel, setCollateralBalanceLabel] = useState("0.00");
  const [isSubmittingMarket, setIsSubmittingMarket] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [createdMarketAddress, setCreatedMarketAddress] = useState("");
  const [isCreateComplete, setIsCreateComplete] = useState(false);

  useEffect(() => {
    if (eventMode === "binary" && outcomes.length !== 2) {
      setOutcomes(["Yes", "No"]);
    } else if (eventMode === "multiple" && outcomes.length < 3) {
      setOutcomes((prev) => prev.length >= 3 ? prev : ["Option 1", "Option 2", "Option 3"]);
    }
  }, [eventMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const readBalance = async () => {
      if (!publicClient || !address) {
        setCollateralBalanceLabel("0.00");
        return;
      }
      try {
        if (collateral.isNative) {
          const raw = await publicClient.getBalance({ address });
          const n = Number(formatUnits(raw, collateral.decimals));
          setCollateralBalanceLabel(n.toLocaleString(undefined, { maximumFractionDigits: 6 }));
          return;
        }
        const rawBalance = (await publicClient.readContract({
          address: collateral.address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        })) as bigint;
        const value = Number(formatUnits(rawBalance, collateral.decimals));
        setCollateralBalanceLabel(value.toLocaleString(undefined, { maximumFractionDigits: 6 }));
      } catch {
        setCollateralBalanceLabel("0.00");
      }
    };
    void readBalance();
  }, [address, publicClient, collateral]);

  useEffect(() => {
    const fetchEthPrice = async () => {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ethereum?: { usd?: number } };
        const v = json?.ethereum?.usd;
        setEthUsdPrice(typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
      } catch {
        setEthUsdPrice(null);
      }
    };
    void fetchEthPrice();
  }, []);

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
      if (assetDropdownRef.current && !assetDropdownRef.current.contains(event.target as Node)) {
        setIsAssetDropdownOpen(false);
      }
      if (
        collateralDropdownRef.current &&
        !collateralDropdownRef.current.contains(event.target as Node)
      ) {
        setIsCollateralDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const resolveUtcLabel = useMemo(() => {
    if (!resolveAfterAt) return "the specified resolve time (UTC)";
    const d = new Date(resolveAfterAt);
    if (Number.isNaN(d.getTime())) return "the specified resolve time (UTC)";
    const readableUtc = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(d);
    return `${readableUtc} UTC`;
  }, [resolveAfterAt]);

  const generatedPricePrompt = useMemo(() => {
    if (marketKind !== "price") return "";
    const dir = comparison === "ABOVE" ? "above" : "below";
    const cleanedThreshold = threshold.replaceAll(",", "").trim();
    const t = cleanedThreshold ? `$${threshold}` : "the selected threshold";
    return `Will ${feed.asset} settle ${dir} ${t} at ${resolveUtcLabel}?`;
  }, [comparison, feed.asset, marketKind, resolveUtcLabel, threshold]);

  const minSeedAmount = useMemo(() => {
    if (collateral.isNative) {
      if (!ethUsdPrice || ethUsdPrice <= 0) return Number.POSITIVE_INFINITY;
      return 10 / ethUsdPrice;
    }
    return 10;
  }, [collateral.isNative, ethUsdPrice]);

  const effectiveTitle = useMemo(
    () => (marketKind === "price" ? generatedPricePrompt : title),
    [generatedPricePrompt, marketKind, title],
  );

  // Auto-generate slug from title/prompt unless user has manually edited it
  useEffect(() => {
    if (!slugManual) setSlug(slugify(marketKind === "price" ? generatedPricePrompt : title));
  }, [title, generatedPricePrompt, marketKind, slugManual]);

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

  const [detailsValidationError, setDetailsValidationError] = useState("");

  const openDetailsPreview = () => {
    const errors: string[] = [];
    if (marketKind === "event" && !title.trim()) errors.push("Title is required.");
    if (!description.trim()) errors.push("Description is required.");
    const filledOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);
    if (filledOutcomes.length < 2) errors.push("At least 2 outcome labels are required.");
    if (outcomes.some((o) => !o.trim())) errors.push("All outcome labels must be filled in.");
    if (!stakeEndAt) errors.push("Stake end time is required.");
    if (!resolveAfterAt) errors.push("Resolve after time is required.");
    if (stakeEndAt && resolveAfterAt) {
      const stakeTs = parseLocalDateTimeToMs(stakeEndAt);
      const resolveTs = parseLocalDateTimeToMs(resolveAfterAt);
      if (resolveTs <= stakeTs) errors.push("Resolve after must be later than stake end.");
    }
    if (!imageFile) errors.push("Cover image is required.");
    if (!slug.trim()) errors.push("Vanity slug is required.");
    if (errors.length > 0) {
      setDetailsValidationError(errors[0]!);
      return;
    }
    setDetailsValidationError("");
    setIsPreviewOpen(true);
  };

  const openPreview = () => {
    const seed = Number(seedAmount);
    if (!Number.isFinite(seed) || seed < minSeedAmount) {
      setSeedValidationError(
        collateral.isNative
          ? `Seed liquidity must be at least $10 worth of ETH (~${minSeedAmount.toFixed(6)} ETH).`
          : `Seed liquidity must be at least 10 ${collateral.symbol}.`,
      );
      return;
    }
    const nOutcomes =
      marketKind === "event" ? outcomes.map((o) => o.trim()).filter(Boolean).length : 2;
    let seedUnits: bigint;
    try {
      seedUnits = parseUnits(seedAmount || "0", collateral.decimals);
    } catch {
      setSeedValidationError("Enter a valid seed amount.");
      return;
    }
    if (nOutcomes > 0 && seedUnits % BigInt(nOutcomes) !== BigInt(0)) {
      const fix = nextDivisibleTotal(seedUnits, nOutcomes);
      const fixLabel = formatUnits(fix, collateral.decimals);
      setSeedValidationError(
        `Seeding splits collateral evenly across ${nOutcomes} outcomes, so the total (in token units) must divide by ${nOutcomes}. ` +
          `Try ${fixLabel} ${collateral.symbol} or another amount where the raw total is a multiple of ${nOutcomes}.`,
      );
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
        ? outcomes.map((o) => o.trim()).filter(Boolean)
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

      const seedUnits = parseUnits(seedAmount || "0", collateral.decimals);
      const minSeedUnits = parseUnits(
        minSeedAmount === Number.POSITIVE_INFINITY ? "999999999" : minSeedAmount.toFixed(collateral.isNative ? 8 : 2),
        collateral.decimals,
      );
      if (seedUnits < minSeedUnits) {
        setSubmitStatus(
          collateral.isNative
            ? `Seed liquidity must be at least $10 worth of ETH (~${minSeedAmount.toFixed(6)} ETH).`
            : `Seed liquidity must be at least 10 ${collateral.symbol}.`,
        );
        return;
      }
      const walletBalance = collateral.isNative
        ? await publicClient.getBalance({ address })
        : ((await publicClient.readContract({
            address: collateral.address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          })) as bigint);
      if (walletBalance < seedUnits) {
        setSubmitStatus(`Insufficient ${collateral.symbol} balance for seed liquidity.`);
        return;
      }

      const stakeTs = BigInt(Math.floor(parseLocalDateTimeToMs(stakeEndAt) / 1000));
      const resolveTs = BigInt(Math.floor(parseLocalDateTimeToMs(resolveAfterAt) / 1000));
      const metadataHash = keccak256(toBytes(metadataUri || "ipfs://pending"));
      const virtualReserve = seedUnits;
      const minBootstrapTotal = minSeedUnits;

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
                  collateralToken: collateral.address,
                  collateralDecimals: collateral.decimals,
                  virtualReserve,
                  stakeEndTimestamp: stakeTs,
                  resolveAfterTimestamp: resolveTs,
                  metadataHash,
                  outcomeLabels: cleanOutcomes,
                  metadataURI: metadataUri,
                  umaAncillary,
                  umaIdentifier: stringToHex("", { size: 32 }),
                  umaLiveness: BigInt(180),
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
                  collateralToken: collateral.address,
                  collateralDecimals: collateral.decimals,
                  virtualReserve,
                  stakeEndTimestamp: stakeTs,
                  resolveAfterTimestamp: resolveTs,
                  metadataHash,
                  outcomeLabels: cleanOutcomes,
                  metadataURI: metadataUri,
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

      // Brief wait for RPC to index the newly-deployed contract before reading state.
      await new Promise((r) => setTimeout(r, 2000));

      // Check if already bootstrapped — may transiently fail on fresh deployments; treat errors as "not yet bootstrapped".
      try {
        const alreadyBootstrapped = (await publicClient.readContract({
          address: createdMarket as `0x${string}`,
          abi: MARKET_ABI,
          functionName: "bootstrapped",
        })) as boolean;
        if (alreadyBootstrapped) {
          setSubmitStatus("Market created, but liquidity was already seeded by another wallet.");
          return;
        }
      } catch {
        // RPC hasn't indexed the new contract yet — safe to proceed with bootstrap.
      }

      const nOutcomes = Number(
        (await publicClient.readContract({
          address: createdMarket as `0x${string}`,
          abi: MARKET_ABI,
          functionName: "numOutcomes",
        })) as number,
      );
      if (nOutcomes > 0 && seedUnits % BigInt(nOutcomes) !== BigInt(0)) {
        const fix = nextDivisibleTotal(seedUnits, nOutcomes);
        const fixLabel = formatUnits(fix, collateral.decimals);
        setSubmitStatus(
          `Seed must divide evenly by ${nOutcomes} outcomes (contract splits integer token units per outcome). Try ${fixLabel} ${collateral.symbol}.`,
        );
        return;
      }

      if (!collateral.isNative) {
        const marketAllowance = (await publicClient.readContract({
          address: collateral.address,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, createdMarket as `0x${string}`],
        })) as bigint;

        if (marketAllowance < seedUnits) {
          setSubmitStatus(`Approve ${collateral.symbol} to seed liquidity...`);
          const approveHash = await walletClient.writeContract({
            chain: walletClient.chain,
            address: collateral.address,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [createdMarket as `0x${string}`, seedUnits],
            account: address,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      setSubmitStatus("Seeding liquidity...");
      const bootstrapHash = await walletClient.writeContract({
        chain: walletClient.chain,
        address: createdMarket as `0x${string}`,
        abi: MARKET_ABI,
        functionName: "bootstrapLiquidity",
        args: [seedUnits, address],
        account: address,
        value: collateral.isNative ? seedUnits : undefined,
        gas: BigInt(800_000),
      });
      await publicClient.waitForTransactionReceipt({ hash: bootstrapHash });

      setSubmitStatus("Market created and liquidity seeded successfully.");
      setIsCreateComplete(true);
      void (async () => {
        try {
          if (collateral.isNative) {
            const raw = await publicClient.getBalance({ address });
            setCollateralBalanceLabel(
              Number(formatUnits(raw, collateral.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 }),
            );
          } else {
            const rawBalance = (await publicClient.readContract({
              address: collateral.address,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [address],
            })) as bigint;
            const value = Number(formatUnits(rawBalance, collateral.decimals));
            setCollateralBalanceLabel(value.toLocaleString(undefined, { maximumFractionDigits: 6 }));
          }
        } catch {
          // no-op
        }
      })();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // Strip verbose viem contract-call dumps — show only the first sentence.
      const clean = raw.split("\n")[0]?.split("Contract Call:")[0]?.trim() ?? "Transaction failed.";
      setSubmitStatus(`Error: ${clean}`);
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
      slug: slug || slugify(effectiveTitle),
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
    <AppLayout
      searchPlaceholder="Search markets... (Ctrl/Cmd + K)"
      showSearch={false}
      pageBackgroundClassName="aftr-page-bg-gradient"
    >
      <div className="mx-auto max-w-3xl px-3 pb-14 md:px-6 md:pb-16">
        {step === "seed" ? (
          <button
            type="button"
            onClick={() => setStep("details")}
            className="mb-6 inline-flex items-center gap-2 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)] md:mb-8 md:text-sm"
          >
            <ArrowLeft size={18} weight="bold" />
            Back to edits
          </button>
        ) : (
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)] md:mb-8 md:text-sm"
          >
            <ArrowLeft size={18} weight="bold" />
            Back to markets
          </Link>
        )}

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
            <>
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
            <section className="py-8">
              <label className={labelClass} htmlFor="slug">Vanity URL slug</label>
              <div className="mt-2 flex overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] focus-within:border-[var(--accent)]">
                <span className="flex items-center border-r border-[var(--border)] bg-[var(--card)] px-3 text-xs text-[var(--muted)] whitespace-nowrap select-none">
                  aftrmarket.markets/m/
                </span>
                <input
                  id="slug"
                  value={slug}
                  onChange={(e) => { setSlug(slugify(e.target.value)); setSlugManual(true); }}
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm font-mono text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
                  placeholder="my-market-slug"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">Auto-generated from title. Edit to customise.</p>
            </section>
            </>
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

          {marketKind === "event" && (
            <section className="py-8">
              <label className={labelClass}>{eventMode === "binary" ? "Outcome labels" : "Options"}</label>
              <div className="mt-3 space-y-3">
                {(eventMode === "binary" ? outcomes.slice(0, 2) : outcomes).map((option, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                    <span className="w-8 shrink-0 text-center text-xs font-semibold text-[var(--muted)]">
                      {idx + 1}
                    </span>
                    <input
                      className="w-full border-0 bg-transparent px-2 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
                      value={option}
                      onChange={(e) => onChangeOutcome(idx, e.target.value)}
                      placeholder={idx === 0 ? "Yes" : idx === 1 ? "No" : `Option ${idx + 1}`}
                    />
                    {eventMode === "multiple" && outcomes.length > 2 && (
                      <button type="button" onClick={() => removeOutcome(idx)}
                        className="h-8 w-8 shrink-0 rounded-lg border border-[var(--border)] text-lg leading-none text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]">
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {eventMode === "multiple" && (
                <button type="button" onClick={addOutcome}
                  className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
                  Add option
                </button>
              )}
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
                          className="h-5 w-5 rounded-full bg-[var(--surface-hover)] object-cover"
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
                              className="h-5 w-5 rounded-full bg-[var(--surface-hover)] object-cover"
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
          ) : null}

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
            <p className="pb-2 text-xs text-[var(--muted)] sm:col-span-2">
              Times are entered in your local timezone and converted to UTC for onchain settlement.
            </p>
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
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={goToSeedStep}
                disabled={isNextLoading}
                className="rounded-full bg-[var(--accent)] py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60 sm:px-10 w-full sm:w-auto"
              >
                {isNextLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                    Uploading...
                  </span>
                ) : (
                  "Next"
                )}
              </button>
              <button
                type="button"
                onClick={openDetailsPreview}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] py-3.5 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] sm:px-8 w-full sm:w-auto"
              >
                Preview
              </button>
            </div>
            {detailsValidationError && (
              <p className="mt-3 text-xs text-red-400">{detailsValidationError}</p>
            )}
            {timeValidationError && (
              <p className="mt-3 text-xs text-red-400">{timeValidationError}</p>
            )}
            {uploadState && <p className="mt-3 text-xs text-[var(--muted)]">{uploadState}</p>}
          </section>
            </>
          ) : (
            <section className="py-10">
              <label className={labelClass}>Collateral</label>
              <div ref={collateralDropdownRef} className="relative mt-2 max-w-[360px]">
                <button
                  type="button"
                  onClick={() => setIsCollateralDropdownOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left text-sm text-[var(--foreground)]"
                >
                  <span className="inline-flex items-center gap-3">
                    <img src={collateral.image} alt={collateral.symbol} className="h-5 w-5 rounded-full object-cover" />
                    <span>{collateral.symbol}</span>
                  </span>
                  <CaretDown size={16} weight="bold" className="text-[var(--muted)]" />
                </button>
                {isCollateralDropdownOpen && (
                  <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl">
                    {COLLATERAL_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setCollateral(opt);
                          setIsCollateralDropdownOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-hover)] ${
                          opt.id === collateral.id ? "bg-[var(--surface)]" : ""
                        }`}
                      >
                        <img src={opt.image} alt={opt.symbol} className="h-5 w-5 rounded-full object-cover" />
                        <span className="text-[var(--foreground)]">{opt.symbol}</span>
                        <span className="text-xs text-[var(--muted)]">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <label className={labelClass} htmlFor="seed-amount">
                Seed liquidity ({collateral.symbol})
              </label>
              <input
                id="seed-amount"
                type="number"
                min={Number.isFinite(minSeedAmount) ? minSeedAmount : 10}
                step="0.01"
                value={seedAmount}
                onChange={(e) => setSeedAmount(e.target.value)}
                className={fieldClass}
                placeholder={
                  collateral.isNative
                    ? `Minimum ${Number.isFinite(minSeedAmount) ? minSeedAmount.toFixed(6) : "0.005"} ETH (~$10)`
                    : `Minimum 10 ${collateral.symbol}`
                }
              />
              <p className="mt-2 text-xs text-[var(--muted)]">
                Wallet balance: {collateralBalanceLabel} {collateral.symbol}
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
        outcomes={outcomes}
        slug={slug}
        stakeEndAt={stakeEndAt}
        resolveAfterAt={resolveAfterAt}
        seedAmount={seedAmount}
        seedSymbol={collateral.symbol}
        umaAncillary={umaAncillary}
        metadataUri={metadataUri}
        isReadOnly={!metadataUri}
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

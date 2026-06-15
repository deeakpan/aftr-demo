"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CaretDown, Plus, Trash } from "@phosphor-icons/react";
import {
  BaseError,
  decodeErrorResult,
  decodeEventLog,
  formatUnits,
  isAddress,
  keccak256,
  parseAbi,
  parseUnits,
  stringToHex,
  toBytes,
  zeroAddress,
  type Address,
} from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { AppLayout } from "@/app/components/app-layout";
import { MarketCoverCropper } from "@/app/components/market-cover-cropper";
import { MarketListCard } from "@/app/market/components/market-list-card";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import deployment, { DEPLOYMENT_CHAIN_ID, DEPLOYMENT_NETWORK_LABEL, wrongNetworkMessage } from "@/lib/deployment";
import { monadTestnet } from "@/lib/chain";
import { brandPageTitle, brandSectionLabel } from "@/lib/brand-font";
import { formatMarketCardDate, MARKET_COVER_RATIO_LABEL } from "@/lib/market-cover";
import { MON_COINGECKO_LOGO } from "@/lib/brand-assets";
import { priceAssetKey } from "@/lib/price-asset-key";
import {
  isValidSourceUrl,
  sanitizeResolutionSourcesForMetadata,
} from "@/lib/market-resolution-sources";

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] sm:text-sm";

const inlineFieldClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] sm:text-sm";

const labelClass = brandSectionLabel;

/** Testnet MON seed floor (not USD-pegged). Passed on-chain as `minBootstrapTotal` for native creates. */
const MIN_MON_SEED = 0.01;

function minSeedUnitsForCollateral(
  collateral: { isNative?: boolean; decimals: number },
  minSeedAmount: number,
): bigint {
  if (collateral.isNative) {
    return parseUnits(String(MIN_MON_SEED), collateral.decimals);
  }
  return parseUnits(minSeedAmount.toFixed(2), collateral.decimals);
}

/** Bootstrap splits `totalAmount` evenly per outcome; contract requires `totalAmount % numOutcomes == 0` in token base units. */
function nextDivisibleTotal(seedUnits: bigint, nOutcomes: number): bigint {
  if (nOutcomes <= 0) return seedUnits;
  const n = BigInt(nOutcomes);
  const rem = seedUnits % n;
  if (rem === BigInt(0)) return seedUnits;
  return seedUnits + (n - rem);
}

type FeedAssetMeta = {
  label: string;
  asset: string;
  logo: string;
};
type Feed = FeedAssetMeta & {
  address: `0x${string}`;
  assetKey: `0x${string}`;
};
const PRICE_FEED_ASSETS: FeedAssetMeta[] =
  (
    deployment as unknown as {
      external?: { priceFeedAssets?: FeedAssetMeta[]; chainlinkFeeds?: FeedAssetMeta[] };
    }
  ).external?.priceFeedAssets ??
  (
    deployment as unknown as {
      external?: { chainlinkFeeds?: FeedAssetMeta[] };
    }
  ).external?.chainlinkFeeds?.map(({ label, asset, logo }) => ({ label, asset, logo })) ??
  [
    {
      label: "BTC/USD",
      asset: "BTC",
      logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
    },
  ];

const CATEGORIES = [
  "Crypto",
  "Politics",
  "Finance",
  "Tech",
  "Economy",
  "Sports",
  "Gaming",
  "Culture",
  "Entertainment",
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
  "function priceFeeds(bytes32 assetKey) view returns (address)",
  "function isSupportedCollateral(address token) view returns (bool)",
  "function resolutionAdminsLength() view returns (uint256)",
  "function resolutionThreshold() view returns (uint256)",
  "function createEventMarket((address collateralToken,uint8 collateralDecimals,uint256 virtualReserve,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,string metadataURI,uint256 minBootstrapTotal,uint256 bootstrapAmount,address shareRecipient) p) payable returns (address market)",
  "function createPriceMarket((address collateralToken,uint8 collateralDecimals,uint256 virtualReserve,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,string metadataURI,bytes32 priceAssetKey,uint256 priceThreshold,uint8 priceKind,uint256 priceUpperBound,uint256 maxPriceStaleness,uint256[] priceBinLower,uint256[] priceBinUpper,uint256 minBootstrapTotal,uint256 bootstrapAmount,address shareRecipient) p) payable returns (address market)",
  "event MarketCreated(address indexed market, uint8 indexed kind, address indexed collateralToken, address[] outcomeTokens, string[] outcomeLabels, uint256 stakeEndTimestamp, uint256 resolveAfterTimestamp, bytes32 metadataHash, address creator)",
  "error InvalidAddress()",
  "error InvalidCollateral()",
  "error InvalidConfig()",
  "error InvalidOutcomes()",
  "error InvalidFeed()",
  "error InvalidTime()",
  "error InvalidMeta()",
  "error InvalidBins()",
  "error InvalidDeployer()",
  "error InvalidBootstrap()",
]);

const CREATE_ERROR_ABI = parseAbi([
  "error InvalidAddress()",
  "error InvalidCollateral()",
  "error InvalidConfig()",
  "error InvalidOutcomes()",
  "error InvalidFeed()",
  "error InvalidTime()",
  "error InvalidMeta()",
  "error InvalidBins()",
  "error InvalidDeployer()",
  "error InvalidBootstrap()",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
]);

function extractRevertData(error: unknown): `0x${string}` | undefined {
  if (!(error instanceof BaseError)) return undefined;
  let data: `0x${string}` | undefined;
  error.walk((e) => {
    const candidate = (e as { data?: unknown }).data;
    if (typeof candidate === "string" && candidate.startsWith("0x")) {
      data = candidate as `0x${string}`;
    }
    return false;
  });
  return data;
}

function formatCreateError(error: unknown, collateralSymbol = "collateral"): string {
  const revertData = extractRevertData(error);
  if (revertData) {
    try {
      const decoded = decodeErrorResult({ abi: CREATE_ERROR_ABI, data: revertData });
      if (decoded.errorName === "ERC20InsufficientAllowance") {
        return `Insufficient ${collateralSymbol} approval for the factory. Approve again and retry.`;
      }
      if (decoded.errorName === "ERC20InsufficientBalance") {
        return `Insufficient ${collateralSymbol} balance for seed liquidity.`;
      }
      if (decoded.errorName === "InvalidTime") {
        return "Stake end and resolve times must be in the future, with resolve after stake end.";
      }
      if (decoded.errorName === "InvalidBootstrap") {
        return "Seed amount must be at least the minimum and divide evenly across outcomes.";
      }
      if (decoded.errorName === "InvalidCollateral") {
        return `${collateralSymbol} is not supported by the factory.`;
      }
      if (decoded.errorName === "InvalidConfig") {
        return "Invalid market config (event markets need resolution admins on the factory, or check outcome count).";
      }
      return decoded.errorName.replace(/([A-Z])/g, " $1").trim();
    } catch {
      // fall through
    }
  }

  if (error instanceof BaseError) {
    const msg = error.shortMessage || error.message;
    if (msg.includes("User rejected")) {
      return "Transaction cancelled in wallet.";
    }
    if (msg.includes("Review alert") || msg.includes("blocked")) {
      return "Wallet security blocked this transaction (Rabby Review alert / MetaMask Blockaid). Rabby: Settings → Security → disable the pre-sign check for testnet, or confirm anyway if you have enough MON for gas. Approving USDC still costs MON gas (~0.005 MON).";
    }
    if (msg.includes("reverted with the following signature")) {
      return "Market creation reverted onchain. Check seed amount, times, and token approval.";
    }
    return msg.split("\n")[0]?.split("Contract Call:")[0]?.trim() || msg;
  }

  return error instanceof Error ? error.message : "Transaction failed.";
}

async function waitForErc20Allowance(
  token: Address,
  owner: Address,
  spender: Address,
  minAmount: bigint,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const allowance = (await deploymentPublicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;
    if (allowance >= minAmount) return;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error("Token approval not detected yet. Wait a few seconds and try again.");
}

const CIRCLE_USDC_BASE_SEPOLIA = deployment.external.umaBondCurrencyCircleUSDC as `0x${string}`;
const FACTORY_ADDRESS = deployment.contracts.MondaloreParimutuelMarketFactory as `0x${string}`;

type CollateralOption = {
  id: "mon" | "usdc" | "aftr_usdc";
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
  const aftrAddr = (c.MondaloreUSDC || "").trim() as `0x${string}`;
  const list: CollateralOption[] = [
    {
      id: "mon",
      label: "Monad",
      symbol: "MON",
      address: zeroAddress,
      decimals: 18,
      image: MON_COINGECKO_LOGO,
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
      label: "Mondalore test USDC",
      symbol: "Mondalore USDC",
      address: aftrAddr,
      decimals: 6,
      image: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    });
  }
  return list;
}

const COLLATERAL_OPTIONS = buildCollateralOptions();

const defaultCollateralOpt =
  COLLATERAL_OPTIONS.find((o) => o.id === "aftr_usdc") ??
  COLLATERAL_OPTIONS.find((o) => o.id === "usdc") ??
  COLLATERAL_OPTIONS[0];

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

function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultDateTimeLocal(daysFromNow: number, hour = 12, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return toDateTimeLocalValue(d);
}

function splitDateTimeLocal(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const [date, time] = value.split("T");
  return { date: date ?? "", time: time?.slice(0, 5) ?? "" };
}

function joinDateTimeLocal(date: string, time: string): string {
  if (!date) return "";
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : "12:00";
  return `${date}T${t}`;
}

function formatLocalDateTimeLabel(value: string): string {
  const ms = parseLocalDateTimeToMs(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function DateTimePicker({
  id,
  label,
  value,
  onChange,
  min,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: string;
  hint: string;
}) {
  const { date: minDate, time: minTime } = splitDateTimeLocal(min);
  const { date, time } = splitDateTimeLocal(value);
  const summary = formatLocalDateTimeLabel(value);

  return (
    <div className="min-w-0">
      <label className={labelClass} htmlFor={`${id}-date`}>
        {label}
      </label>
      <div className="create-datetime-group mt-2 flex min-w-0 max-w-full items-stretch overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] focus-within:border-[var(--accent)]">
        <input
          id={`${id}-date`}
          type="date"
          value={date}
          min={minDate || undefined}
          onChange={(e) => onChange(joinDateTimeLocal(e.target.value, time))}
          className="create-date-input min-w-0 flex-1 border-0 bg-transparent px-3 py-3 text-sm text-[var(--foreground)] outline-none"
          aria-label={`${label} date`}
        />
        <span className="w-px shrink-0 self-stretch bg-[var(--border)]" aria-hidden />
        <input
          id={`${id}-time`}
          type="time"
          value={time}
          min={date && date === minDate && minTime ? minTime : undefined}
          onChange={(e) => onChange(joinDateTimeLocal(date, e.target.value))}
          className="create-time-input w-[4.85rem] shrink-0 border-0 bg-transparent px-2 py-3 text-sm text-[var(--foreground)] outline-none sm:w-[6.25rem]"
          aria-label={`${label} time`}
        />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
        {summary ? (
          <>
            <span className="font-medium text-[var(--foreground)]">{summary}</span>
            <span className="text-[var(--muted)]"> · local time</span>
          </>
        ) : (
          hint
        )}
      </p>
    </div>
  );
}

export function CreateClient() {
  const publicClient = deploymentPublicClient;
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [marketKind, setMarketKind] = useState<"event" | "price">("event");
  const [eventMode, setEventMode] = useState<"binary" | "multiple">("binary");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resolutionSources, setResolutionSources] = useState([{ label: "", url: "" }]);
  const [outcomes, setOutcomes] = useState(["Yes", "No"]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feed, setFeed] = useState<Feed | null>(null);
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
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [seedAmount, setSeedAmount] = useState("10");
  const [stakeEndAt, setStakeEndAt] = useState(() => defaultDateTimeLocal(7));
  const [resolveAfterAt, setResolveAfterAt] = useState(() => defaultDateTimeLocal(8));
  const [step, setStep] = useState<"details" | "seed">("details");
  const [isNextLoading, setIsNextLoading] = useState(false);
  const [isAssetDropdownOpen, setIsAssetDropdownOpen] = useState(false);
  const [isCollateralDropdownOpen, setIsCollateralDropdownOpen] = useState(false);
  const [seedValidationError, setSeedValidationError] = useState("");
  const [previewImageSrc, setPreviewImageSrc] = useState("");
  const assetDropdownRef = useRef<HTMLDivElement>(null);
  const collateralDropdownRef = useRef<HTMLDivElement>(null);
  const [brokenLogoAddresses, setBrokenLogoAddresses] = useState<string[]>([]);
  const [timeValidationError, setTimeValidationError] = useState("");
  const [collateral, setCollateral] = useState<CollateralOption>(defaultCollateralOpt!);
  const [supportedCollaterals, setSupportedCollaterals] = useState<CollateralOption[]>(COLLATERAL_OPTIONS);
  const [collateralBalanceLabel, setCollateralBalanceLabel] = useState("0.00");
  const [isSubmittingMarket, setIsSubmittingMarket] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [isCreateComplete, setIsCreateComplete] = useState(false);

  useEffect(() => {
    if (eventMode === "binary" && outcomes.length !== 2) {
      setOutcomes(["Yes", "No"]);
    } else if (eventMode === "multiple" && outcomes.length < 3) {
      setOutcomes((prev) => prev.length >= 3 ? prev : ["Option 1", "Option 2", "Option 3"]);
    }
  }, [eventMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!publicClient || !FACTORY_ADDRESS) return;
    let cancelled = false;
    void (async () => {
      const supported: CollateralOption[] = [];
      for (const opt of COLLATERAL_OPTIONS) {
        const ok = (await publicClient.readContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "isSupportedCollateral",
          args: [opt.address],
        })) as boolean;
        if (ok) supported.push(opt);
      }
      if (cancelled) return;
      setSupportedCollaterals(supported);
      setCollateral((prev) => {
        if (supported.some((o) => o.id === prev.id)) return prev;
        return supported[0] ?? prev;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient]);

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
    return () => {
      if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    };
  }, [cropSourceUrl]);

  const handleCoverFilePick = (file: File | null) => {
    if (!file) return;
    if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    setCropSourceUrl(URL.createObjectURL(file));
    setCropFileName(file.name);
    setImageUri("");
  };

  const handleCropCancel = () => {
    if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    setCropSourceUrl(null);
    setCropFileName("");
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const handleCropConfirm = (file: File) => {
    setImageFile(file);
    setImageUri("");
    handleCropCancel();
  };

  const previewResolveLabel = useMemo(
    () => formatMarketCardDate(resolveAfterAt),
    [resolveAfterAt],
  );

  useEffect(() => {
    if (!publicClient || !FACTORY_ADDRESS) return;
    let cancelled = false;
    void (async () => {
      const registered: Feed[] = [];
      for (const meta of PRICE_FEED_ASSETS) {
        const key = priceAssetKey(meta.asset);
        const addr = (await publicClient.readContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "priceFeeds",
          args: [key],
        })) as `0x${string}`;
        if (addr !== zeroAddress) {
          registered.push({ ...meta, address: addr, assetKey: key });
        }
      }
      if (cancelled) return;
      setFeeds(registered);
      setFeed((prev) => {
        if (prev && registered.some((r) => r.assetKey === prev.assetKey)) return prev;
        return registered[0] ?? null;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  useEffect(() => {
    const run = async () => {
      if (!publicClient || marketKind !== "price" || !feed?.address) return;
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
    // Always English in the onchain title; values are still the same instant (UTC labels).
    const readableUtc = new Intl.DateTimeFormat("en-US", {
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
    return `Will ${feed?.asset ?? "asset"} settle ${dir} ${t} at ${resolveUtcLabel}?`;
  }, [comparison, feed?.asset, marketKind, resolveUtcLabel, threshold]);

  const minSeedAmount = useMemo(() => {
    if (collateral.isNative) return MIN_MON_SEED;
    return 10;
  }, [collateral.isNative]);

  const effectiveTitle = useMemo(
    () => (marketKind === "price" ? generatedPricePrompt : title),
    [generatedPricePrompt, marketKind, title],
  );

  // Auto-generate slug from title/prompt unless user has manually edited it
  useEffect(() => {
    if (!slugManual) setSlug(slugify(marketKind === "price" ? generatedPricePrompt : title));
  }, [title, generatedPricePrompt, marketKind, slugManual]);

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

  const validateSeedAmount = (): boolean => {
    const seed = Number(seedAmount);
    if (!Number.isFinite(seed) || seed < minSeedAmount) {
      setSeedValidationError(
        collateral.isNative
          ? `Seed liquidity must be at least ${MIN_MON_SEED} MON.`
          : `Seed liquidity must be at least 10 ${collateral.symbol}.`,
      );
      return false;
    }
    const nOutcomes =
      marketKind === "event" ? outcomes.map((o) => o.trim()).filter(Boolean).length : 2;
    let seedUnits: bigint;
    try {
      seedUnits = parseUnits(seedAmount || "0", collateral.decimals);
    } catch {
      setSeedValidationError("Enter a valid seed amount.");
      return false;
    }
    if (nOutcomes > 0 && seedUnits % BigInt(nOutcomes) !== BigInt(0)) {
      const fix = nextDivisibleTotal(seedUnits, nOutcomes);
      const fixLabel = formatUnits(fix, collateral.decimals);
      setSeedValidationError(
        `Seeding splits collateral evenly across ${nOutcomes} outcomes, so the total (in token units) must divide by ${nOutcomes}. ` +
          `Try ${fixLabel} ${collateral.symbol} or another amount where the raw total is a multiple of ${nOutcomes}.`,
      );
      return false;
    }
    setSeedValidationError("");
    return true;
  };

  const handleCreateMarket = async () => {
    if (!validateSeedAmount()) return;
    if (!address || !publicClient || !walletClient) {
      setSubmitStatus("Connect wallet first.");
      return;
    }
    if (chainId !== DEPLOYMENT_CHAIN_ID) {
      setSubmitStatus(wrongNetworkMessage());
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

    if (marketKind === "event") {
      const [adminCount, threshold] = await Promise.all([
        publicClient.readContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "resolutionAdminsLength",
        }),
        publicClient.readContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "resolutionThreshold",
        }),
      ]);
      if (BigInt(adminCount as bigint) < BigInt(threshold as bigint)) {
        setSubmitStatus(
          `Event markets are not ready on this factory yet (need ${threshold} resolution admins, have ${adminCount}). Use a price market instead.`,
        );
        return;
      }
    }

    try {
      setIsSubmittingMarket(true);
      setSubmitStatus("Preparing transaction...");
      setIsCreateComplete(false);

      const seedUnits = parseUnits(seedAmount || "0", collateral.decimals);
      const minSeedUnits = minSeedUnitsForCollateral(collateral, minSeedAmount);
      if (seedUnits < minSeedUnits) {
        setSubmitStatus(
          collateral.isNative
            ? `Seed liquidity must be at least ${MIN_MON_SEED} MON.`
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
      if (!collateral.isNative && walletBalance < seedUnits) {
        setSubmitStatus(`Insufficient ${collateral.symbol} balance for seed liquidity.`);
        return;
      }

      const stakeTs = BigInt(Math.floor(parseLocalDateTimeToMs(stakeEndAt) / 1000));
      const resolveTs = BigInt(Math.floor(parseLocalDateTimeToMs(resolveAfterAt) / 1000));
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      if (stakeTs <= nowSec || resolveTs <= stakeTs) {
        setSubmitStatus("Stake end and resolve times must still be in the future. Go back and update them.");
        return;
      }

      const collateralSupported = (await publicClient.readContract({
        address: FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: "isSupportedCollateral",
        args: [collateral.address],
      })) as boolean;
      if (!collateralSupported) {
        setSubmitStatus(
          `${collateral.symbol} is not enabled on the factory yet. Choose Mondalore USDC or WETH.`,
        );
        return;
      }

      const metadataHash = keccak256(toBytes(metadataUri || "ipfs://pending"));
      const virtualReserve = seedUnits;
      const minBootstrapTotal = minSeedUnits;

      if (!metadataUri.trim()) {
        setSubmitStatus("Metadata is missing. Go back and upload market details again.");
        return;
      }

      const nOutcomes = cleanOutcomes.length;
      if (nOutcomes > 0 && seedUnits % BigInt(nOutcomes) !== BigInt(0)) {
        const fix = nextDivisibleTotal(seedUnits, nOutcomes);
        const fixLabel = formatUnits(fix, collateral.decimals);
        setSubmitStatus(
          `Seed must divide evenly by ${nOutcomes} outcomes. Try ${fixLabel} ${collateral.symbol}.`,
        );
        return;
      }

      const sharedParams = {
        collateralToken: collateral.address,
        collateralDecimals: collateral.decimals,
        virtualReserve,
        stakeEndTimestamp: stakeTs,
        resolveAfterTimestamp: resolveTs,
        metadataHash,
        outcomeLabels: cleanOutcomes,
        metadataURI: metadataUri,
        minBootstrapTotal,
        bootstrapAmount: seedUnits,
        shareRecipient: address,
      };

      if (!collateral.isNative) {
        const factoryAllowance = (await publicClient.readContract({
          address: collateral.address,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, FACTORY_ADDRESS],
        })) as bigint;

        if (factoryAllowance < seedUnits) {
          const approveSimulation = await publicClient.simulateContract({
            address: collateral.address,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [FACTORY_ADDRESS, seedUnits],
            account: address,
          });
          const baseApproveGas =
            approveSimulation.request.gas ??
            (await publicClient.estimateContractGas({
              address: collateral.address,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [FACTORY_ADDRESS, seedUnits],
              account: address,
            }));
          const approveGasLimit = baseApproveGas + baseApproveGas / BigInt(5);
          const monBalance = await publicClient.getBalance({ address });
          if (monBalance < approveGasLimit) {
            setSubmitStatus(
              `Need ~${formatUnits(approveGasLimit, 18)} MON for approval gas. You have ${formatUnits(monBalance, 18)} MON on ${DEPLOYMENT_NETWORK_LABEL}.`,
            );
            return;
          }

          setSubmitStatus(
            `Approve ${formatUnits(seedUnits, collateral.decimals)} ${collateral.symbol} (exact seed amount only)…`,
          );
          const approveHash = await walletClient.writeContract({
            ...approveSimulation.request,
            chain: walletClient.chain,
            gas: approveGasLimit,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          setSubmitStatus("Waiting for approval to confirm...");
          await waitForErc20Allowance(collateral.address, address, FACTORY_ADDRESS, seedUnits);
        }
      }

      if (!collateral.isNative) {
        const allowanceBeforeCreate = (await publicClient.readContract({
          address: collateral.address,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, FACTORY_ADDRESS],
        })) as bigint;
        if (allowanceBeforeCreate < seedUnits) {
          setSubmitStatus(
            `Insufficient ${collateral.symbol} allowance for the factory (have ${formatUnits(allowanceBeforeCreate, collateral.decimals)}, need ${formatUnits(seedUnits, collateral.decimals)}). Approve again.`,
          );
          return;
        }
      }

      const createGasBuffer = (estimated: bigint) =>
        estimated + estimated / BigInt(10);

      setSubmitStatus("Simulating market creation...");
      let createHash: `0x${string}`;

      const estimateCreateGas = async (
        fn: "createEventMarket" | "createPriceMarket",
        args: readonly unknown[],
        value?: bigint,
      ) => {
        const estimated = await publicClient.estimateContractGas({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: fn,
          args: args as never,
          account: address,
          value,
        });
        return createGasBuffer(estimated);
      };

      const assertNativeMonAffordable = async (seed: bigint, gasLimit: bigint): Promise<boolean> => {
        const monBalance = await publicClient.getBalance({ address });
        const totalNeeded = seed + gasLimit;
        if (monBalance >= totalNeeded) return true;
        const have = formatUnits(monBalance, 18);
        const need = formatUnits(totalNeeded, 18);
        const seedLabel = formatUnits(seed, 18);
        const gasLabel = formatUnits(gasLimit, 18);
        setSubmitStatus(
          `Insufficient MON on ${DEPLOYMENT_NETWORK_LABEL}. Need ~${need} MON (${seedLabel} seed + ~${gasLabel} gas). You have ${have} MON.`,
        );
        return false;
      };

      if (marketKind === "event") {
        const eventArgs = [{ ...sharedParams }] as const;

        const simulation = await publicClient.simulateContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "createEventMarket",
          args: eventArgs,
          account: address,
          value: collateral.isNative ? seedUnits : undefined,
        });

        setSubmitStatus("Creating market and seeding liquidity...");
        const eventGas = await estimateCreateGas(
          "createEventMarket",
          eventArgs,
          collateral.isNative ? seedUnits : undefined,
        );
        if (collateral.isNative && !(await assertNativeMonAffordable(seedUnits, eventGas))) {
          return;
        }
        createHash = await walletClient.writeContract({
          ...simulation.request,
          chain: walletClient.chain ?? monadTestnet,
          gas: eventGas,
        });
      } else {
        if (!feed?.assetKey) {
          setSubmitStatus("No registered price feed for this asset on the factory.");
          return;
        }
        const priceArgs = [
          {
            ...sharedParams,
            priceAssetKey: feed.assetKey,
            priceThreshold: parseUnits(cleanedThreshold || "0", 8),
            priceKind: (comparison === "ABOVE" ? 0 : 1) as 0 | 1,
            priceUpperBound: BigInt(0),
            maxPriceStaleness: BigInt(3600),
            priceBinLower: [] as readonly bigint[],
            priceBinUpper: [] as readonly bigint[],
          },
        ] as const;

        const simulation = await publicClient.simulateContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "createPriceMarket",
          args: priceArgs,
          account: address,
          value: collateral.isNative ? seedUnits : undefined,
        });

        setSubmitStatus("Creating market and seeding liquidity...");
        const priceGas = await estimateCreateGas(
          "createPriceMarket",
          priceArgs,
          collateral.isNative ? seedUnits : undefined,
        );
        if (collateral.isNative && !(await assertNativeMonAffordable(seedUnits, priceGas))) {
          return;
        }
        createHash = await walletClient.writeContract({
          ...simulation.request,
          chain: walletClient.chain ?? monadTestnet,
          gas: priceGas,
        });
      }

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

      setSubmitStatus("Market created successfully.");
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
      setSubmitStatus(`Error: ${formatCreateError(error, collateral.symbol)}`);
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
              asset: feed?.asset,
              assetKey: feed?.assetKey,
              feed: feed?.label,
              feedAddress: feed?.address,
              currentPrice: currentPriceLabel,
              comparison,
              threshold,
              generatedPrompt: generatedPricePrompt,
            }
          : null,
      resolution: marketKind === "event" ? "community-3-of-10-admins" : null,
      resolutionSources:
        marketKind === "event" ? sanitizeResolutionSourcesForMetadata(resolutionSources) : [],
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
    const errors: string[] = [];
    if (marketKind === "event" && !title.trim()) errors.push("Title is required.");
    if (!description.trim()) errors.push("Description is required.");
    if (marketKind === "event") {
      const validSources = sanitizeResolutionSourcesForMetadata(resolutionSources);
      if (validSources.length === 0) {
        errors.push("Add at least one resolution source URL (https://…) for event markets.");
      }
    }
    const filledOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);
    if (filledOutcomes.length < 2) errors.push("At least 2 outcome labels are required.");
    if (outcomes.some((o) => !o.trim())) errors.push("All outcome labels must be filled in.");
    if (!stakeEndAt) errors.push("Stake end time is required.");
    if (!resolveAfterAt) errors.push("Resolve after time is required.");
    if (!slug.trim()) errors.push("Vanity slug is required.");
    if (errors.length > 0) {
      setDetailsValidationError(errors[0]!);
      return;
    }
    setDetailsValidationError("");

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
      <div className="mx-auto min-w-0 max-w-3xl overflow-x-clip px-3 pb-14 md:px-6 md:pb-16">
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
            <h1 className={`text-xl tracking-tight md:text-3xl ${brandPageTitle}`}>Create market</h1>
          </div>
        </div>

        <div className="min-w-0 space-y-0 divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {step === "details" ? (
            <>
          <section className="py-8">
            <p className={labelClass}>Market type</p>
            <div className="mt-4 inline-flex rounded-full bg-[var(--surface)] p-1">
              {(
                [
                  { id: "event" as const, label: "Event (community)" },
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
              <label className={labelClass}>Resolution sources</label>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                Public links where the official result will be published — admins use these when
                signing the outcome.
              </p>
              <div className="mt-3 space-y-3">
                {resolutionSources.map((source, idx) => (
                  <div key={idx} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      className={`${inlineFieldClass} sm:max-w-[11rem]`}
                      placeholder="Label (optional)"
                      value={source.label}
                      onChange={(e) => {
                        const next = [...resolutionSources];
                        next[idx] = { ...next[idx]!, label: e.target.value };
                        setResolutionSources(next);
                      }}
                    />
                    <input
                      className={`${inlineFieldClass} min-w-0 flex-1`}
                      placeholder="https://official-results.example.com/…"
                      value={source.url}
                      onChange={(e) => {
                        const next = [...resolutionSources];
                        next[idx] = { ...next[idx]!, url: e.target.value };
                        setResolutionSources(next);
                      }}
                    />
                    {resolutionSources.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remove source"
                        onClick={() =>
                          setResolutionSources((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="flex h-11 w-11 shrink-0 items-center justify-center self-end rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--outcome-no)] sm:self-center"
                      >
                        <Trash size={16} weight="bold" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setResolutionSources((prev) => [...prev, { label: "", url: "" }])
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] transition hover:underline"
                >
                  <Plus size={14} weight="bold" />
                  Add source
                </button>
              </div>
              {resolutionSources.some((s) => s.url.trim() && !isValidSourceUrl(s.url)) && (
                <p className="mt-2 text-xs text-[var(--outcome-no)]">
                  Each source must be a valid http or https URL.
                </p>
              )}
            </section>
          )}

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
                {feeds.length === 0 && (
                  <p className="mt-2 text-xs text-amber-400">
                    No price feeds registered on the factory yet. Owner must call setPriceFeed (e.g. BTC mock).
                  </p>
                )}
                <div ref={assetDropdownRef} className="relative mt-2">
                  <button
                    type="button"
                    disabled={!feed}
                    onClick={() => setIsAssetDropdownOpen((v) => !v)}
                    className="flex w-full max-w-[300px] items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left text-sm text-[var(--foreground)] disabled:opacity-50 md:max-w-[360px] md:px-4 md:py-3"
                  >
                    <span className="inline-flex items-center gap-3">
                      {!feed ? (
                        <span className="text-[var(--muted)]">Select asset</span>
                      ) : (
                        <>
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
                        </>
                      )}
                    </span>
                    <CaretDown size={16} weight="bold" className="text-[var(--muted)]" />
                  </button>
                  {isAssetDropdownOpen && feed && (
                    <div className="absolute z-30 mt-2 max-h-64 w-full max-w-[300px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl md:max-w-[360px]">
                      {feeds.map((f) => (
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

          <section className="grid min-w-0 gap-6 py-8 md:grid-cols-2">
            <DateTimePicker
              id="stake-end"
              label="Stake ends"
              value={stakeEndAt}
              onChange={setStakeEndAt}
              min={minDateTimeLocal}
              hint="When pool trading closes"
            />
            <DateTimePicker
              id="resolve-after"
              label="Resolve after"
              value={resolveAfterAt}
              onChange={setResolveAfterAt}
              min={minDateTimeLocal}
              hint="Earliest settlement time"
            />
            <p className="min-w-0 text-xs text-[var(--muted)] md:col-span-2">
              Times are entered in your local timezone and converted to UTC for onchain settlement.
            </p>
          </section>

          <section className="py-8">
            <label className={labelClass} htmlFor="image">
              Cover image
            </label>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Recommended banner ratio {MARKET_COVER_RATIO_LABEL}.
            </p>
            <input
              ref={imageInputRef}
              id="image"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => handleCoverFilePick(e.target.files?.[0] ?? null)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
              >
                Choose file
              </button>
              <span className="text-sm text-[var(--foreground)]">
                {imageFile
                  ? `${imageFile.name} (${Math.round(imageFile.size / 1024)} KB)`
                  : "No file chosen"}
              </span>
            </div>

            {(previewImageSrc || effectiveTitle.trim() || outcomes.some((o) => o.trim())) && (
              <div className="mt-6 max-w-sm">
                <p className={`mb-2 text-xs uppercase tracking-wider text-[var(--muted)] ${brandSectionLabel}`}>
                  Card preview
                </p>
                <MarketListCard
                  title={effectiveTitle}
                  imageUrl={previewImageSrc || undefined}
                  outcomeLabels={outcomes}
                  resolveAfter={previewResolveLabel}
                  showNewBadge
                  interactive={false}
                />
              </div>
            )}
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
                    {supportedCollaterals.map((opt) => (
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
              {supportedCollaterals.length === 0 && (
                <p className="mt-2 text-xs text-amber-400">
                  Loading supported collateral from factory…
                </p>
              )}

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
                    ? `Minimum ${MIN_MON_SEED} MON`
                    : `Minimum 10 ${collateral.symbol}`
                }
              />
              <p className="mt-2 text-xs text-[var(--muted)]">
                Wallet balance: {collateralBalanceLabel} {collateral.symbol}
              </p>
              {marketKind === "event" && (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  Event markets settle via 3-of-10 factory admin signatures (per market + outcome).
                </p>
              )}
              <p className="mt-3 text-xs text-[var(--muted)]">
                As creator, you earn 0.3% of each trade.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {isCreateComplete ? (
                  <Link
                    href="/market"
                    className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
                  >
                    View markets
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleCreateMarket()}
                    disabled={isSubmittingMarket || !metadataUri}
                    className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmittingMarket ? "Processing…" : "Create market"}
                  </button>
                )}
              </div>
              {seedValidationError && (
                <p className="mt-3 text-xs text-red-400">{seedValidationError}</p>
              )}
              {submitStatus && (
                <p
                  className={`mt-3 text-sm ${
                    isCreateComplete || /successfully/i.test(submitStatus)
                      ? "font-bold text-emerald-400"
                      : /error|failed|insufficient|missing|invalid/i.test(submitStatus)
                        ? "font-semibold text-rose-400"
                        : "font-medium text-[var(--foreground)]"
                  }`}
                >
                  {submitStatus}
                </p>
              )}
            </section>
          )}
        </div>
      </div>
      {cropSourceUrl && (
        <MarketCoverCropper
          imageSrc={cropSourceUrl}
          fileName={cropFileName || "market-cover.webp"}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </AppLayout>
  );
}

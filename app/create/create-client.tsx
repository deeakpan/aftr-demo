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
import { AppLayout } from "@/app/components/app-layout";
import { MarketCoverCropper } from "@/app/components/market-cover-cropper";
import { MarketListCard } from "@/app/market/components/market-list-card";
import { NadMarketListCard } from "@/app/market/components/nad-market-list-card";
import {
  PonsMarketCreateSection,
  type PonsCreateDraft,
} from "@/app/create/components/pons-market-create-section";
import { ponsMarketForCardPreview, ponsStatsForCardPreview } from "@/lib/pons/adapt-display";
import { PolymarketImportModal } from "@/app/create/components/polymarket-import-modal";
import { deploymentPublicClient } from "@/lib/deployment-public-client";
import deployment, {
  DEPLOYMENT_CHAIN_ID,
  DEPLOYMENT_NETWORK_LABEL,
  deploymentExternal,
  isDeployedAddress,
  undeployedStackMessage,
  usesFpmmMechanism,
  wrongNetworkMessage,
} from "@/lib/deployment";
import { activeMarketFactoryAddress } from "@/lib/market-factory";
import { DEPLOYMENT_CHAIN, NATIVE_CURRENCY_SYMBOL } from "@/lib/chain";
import { useSessionWallet } from "@/lib/session-wallet";
import {
  isReservedMarketSlug,
  slugifyMarket,
} from "@/lib/markets/market-url";
import { withOtherOption, type PolymarketImportDraft } from "@/lib/polymarket/import";
import { marketSlugPrefixLabel } from "@/lib/site-url";
import { brandSectionHeading, brandSectionLabel } from "@/lib/brand-font";
import { formatMarketCardDate, MARKET_COVER_RATIO_LABEL } from "@/lib/market-cover";
import {
  isPonsQuestionType,
  validatePonsResolveAfter,
} from "@/lib/pons/question-types";
import type { PonsQuestionType } from "@/lib/pons/types";
import { MON_COINGECKO_LOGO } from "@/lib/brand-assets";
import { priceAssetKey } from "@/lib/price-asset-key";
import { formatUserTxError } from "@/lib/tx-error";
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

/** Human-readable seed that divides evenly across outcomes (raw units), at/above `approx`. */
function divisibleSeedSuggestion(
  approx: number,
  decimals: number,
  nOutcomes: number,
  minHuman: number,
): string {
  const floor = Math.max(approx, minHuman);
  const whole = Math.floor(floor);
  let units = parseUnits(String(whole), decimals);
  const minUnits = parseUnits(
    Number.isInteger(minHuman) ? String(minHuman) : minHuman.toFixed(Math.min(8, decimals)),
    decimals,
  );
  if (units < minUnits) units = minUnits;
  units = nextDivisibleTotal(units, nOutcomes);
  const formatted = formatUnits(units, decimals);
  // Trim trailing zeros but keep required fractional digits (e.g. 10.000002).
  if (!formatted.includes(".")) return formatted;
  return formatted.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "") || formatted;
}

function buildSeedQuickAmounts(
  decimals: number,
  nOutcomes: number,
  minHuman: number,
): string[] {
  if (nOutcomes <= 0) return [];
  const bases = [10, 100, 1000, 10_000].filter((b) => b >= minHuman - 1e-9);
  // Always include a near-min option when min isn't already ~10.
  if (minHuman < 10 && !bases.includes(10)) {
    bases.unshift(Math.max(minHuman, 0.01));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const base of bases) {
    const label = divisibleSeedSuggestion(base, decimals, nOutcomes, minHuman);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= 4) break;
  }
  return out;
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
  "function createNadTokenMarket((address collateralToken,uint8 collateralDecimals,uint256 virtualReserve,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,string metadataURI,uint256 minBootstrapTotal,uint256 bootstrapAmount,address shareRecipient) p) payable returns (address market)",
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
  "error InvalidFunding()",
]);
const FPMM_FACTORY_ABI = parseAbi([
  "function priceFeeds(bytes32 assetKey) view returns (address)",
  "function isSupportedCollateral(address token) view returns (bool)",
  "function resolutionAdminsLength() view returns (uint256)",
  "function resolutionThreshold() view returns (uint256)",
  "function createEventMarket((address collateralToken,uint8 collateralDecimals,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,string metadataURI,uint256 minInitialFunding,uint256 initialFunding,uint256[] fundingHint,address shareRecipient) p) returns (address market)",
  "function createPonsMarket((address collateralToken,uint8 collateralDecimals,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,string metadataURI,uint256 minInitialFunding,uint256 initialFunding,uint256[] fundingHint,address shareRecipient) p) returns (address market)",
  "function createPriceMarket((address collateralToken,uint8 collateralDecimals,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,string metadataURI,uint256 minInitialFunding,uint256 initialFunding,uint256[] fundingHint,address shareRecipient,bytes32 priceAssetKey,uint256 priceThreshold,uint8 priceKind,uint256 priceUpperBound,uint256 maxPriceStaleness,uint256[] priceBinLower,uint256[] priceBinUpper) p) returns (address market)",
  "event MarketCreated(address indexed market, uint8 indexed kind, address indexed collateralToken, address[] outcomeTokens, string[] outcomeLabels, uint256 stakeEndTimestamp, uint256 resolveAfterTimestamp, bytes32 metadataHash, address creator)",
  "error InvalidCollateral()",
  "error InvalidFeed()",
  "error InvalidTime()",
  "error InvalidMeta()",
  "error InvalidFunding()",
]);
const USE_FPMM = usesFpmmMechanism();
const ACTIVE_FACTORY_ABI = USE_FPMM ? FPMM_FACTORY_ABI : FACTORY_ABI;

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
      if (decoded.errorName === "InvalidBootstrap" || decoded.errorName === "InvalidFunding") {
        return "Seed amount must meet the minimum initial funding for this market.";
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
    if (msg.includes("Review alert") || msg.includes("blocked")) {
      return "Wallet security blocked this transaction. Confirm in your wallet or add ETH for gas and retry.";
    }
  }

  return formatUserTxError(error, "Market creation failed. Try again.");
}

function createStageLabel(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("approv")) return "Approving";
  if (s.includes("prepar")) return "Preparing";
  if (s.includes("simulat") || s.includes("creating")) return "Creating";
  return "Creating";
}

function isCreateProgressStatus(status: string): boolean {
  return /preparing transaction|waiting for approval|simulating market|creating market|creating pons|market created successfully/i.test(
    status,
  );
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

const CIRCLE_USDC_BASE_SEPOLIA = (
  (deployment.external as { umaBondCurrencyCircleUSDC?: string }).umaBondCurrencyCircleUSDC ??
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
) as `0x${string}`;
const FACTORY_ADDRESS = (activeMarketFactoryAddress() ??
  deployment.contracts.MondaloreParimutuelMarketFactory) as `0x${string}`;
const factoryDeployed = isDeployedAddress(FACTORY_ADDRESS);

type CollateralOption = {
  id: "mon" | "usdc" | "aftr_usdc" | "usdg";
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
  const native = DEPLOYMENT_CHAIN.nativeCurrency;
  const list: CollateralOption[] = [
    {
      id: "mon",
      label: native.name,
      symbol: native.symbol,
      address: zeroAddress,
      decimals: native.decimals,
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
      label: "USDC",
      symbol: "USDC",
      address: aftrAddr,
      decimals: 6,
      image: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    });
  }
  const usdgAddr = (
    (deployment.contracts as Record<string, string | undefined>).USDG ??
    deploymentExternal().pons?.usdg
  )?.trim() as `0x${string}` | undefined;
  if (isAddress(usdgAddr ?? "", { strict: false })) {
    list.push({
      id: "usdg",
      label: "USDG",
      symbol: "USDG",
      address: usdgAddr!,
      decimals: 6,
      image: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    });
  }
  return list;
}

const COLLATERAL_OPTIONS = buildCollateralOptions();

const defaultCollateralOpt =
  COLLATERAL_OPTIONS.find((o) => o.id === "usdg") ??
  COLLATERAL_OPTIONS.find((o) => o.id === "aftr_usdc") ??
  COLLATERAL_OPTIONS.find((o) => o.id === "usdc") ??
  COLLATERAL_OPTIONS[0];

function numString(idx: number) {
  return String(idx);
}

function slugify(text: string): string {
  return slugifyMarket(text);
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

type CreateMarketKind = "event" | "price" | "pons";

function parseCreateMarketKind(raw: string | null): CreateMarketKind {
  if (raw === "price" || raw === "pons" || raw === "event") return raw;
  return "event";
}

export function CreateClient() {
  const publicClient = deploymentPublicClient;
  const { address, chainId, writeContract } = useSessionWallet();
  const [marketKind, setMarketKindState] = useState<CreateMarketKind>("event");
  const [ponsQuestionType, setPonsQuestionType] = useState<PonsQuestionType>("mcap_usd_above");

  const writeCreateQuery = (kind: CreateMarketKind, q: PonsQuestionType) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("type", kind);
    if (kind === "pons") url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    const next = `${url.pathname}${url.search}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== next) window.history.replaceState(window.history.state, "", next);
  };

  useEffect(() => {
    const applyFromLocation = () => {
      const params = new URLSearchParams(window.location.search);
      setMarketKindState(parseCreateMarketKind(params.get("type")));
      const q = params.get("q");
      setPonsQuestionType(isPonsQuestionType(q) ? q : "mcap_usd_above");
    };
    applyFromLocation();
    window.addEventListener("popstate", applyFromLocation);
    return () => window.removeEventListener("popstate", applyFromLocation);
  }, []);

  const setMarketKind = (id: CreateMarketKind) => {
    setMarketKindState(id);
    writeCreateQuery(id, ponsQuestionType);
  };
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
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugCheckBusy, setSlugCheckBusy] = useState(false);
  const [slugCheckMessage, setSlugCheckMessage] = useState("");
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
  const [ponsDraft, setPonsDraft] = useState<PonsCreateDraft | null>(null);
  const [ponsDuplicateBlocked, setPonsDuplicateBlocked] = useState(false);
  const [polyImportOpen, setPolyImportOpen] = useState(false);

  useEffect(() => {
    if (eventMode === "binary" && outcomes.length !== 2) {
      setOutcomes(["Yes", "No"]);
    } else if (eventMode === "multiple" && outcomes.length < 3) {
      setOutcomes((prev) => prev.length >= 3 ? prev : ["Option 1", "Option 2", "Option 3"]);
    }
  }, [eventMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!publicClient || !factoryDeployed) return;
    let cancelled = false;
    void (async () => {
      try {
        const supported: CollateralOption[] = [];
        for (const opt of COLLATERAL_OPTIONS) {
          const ok = (await publicClient.readContract({
            address: FACTORY_ADDRESS,
            abi: ACTIVE_FACTORY_ABI,
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
      } catch {
        if (!cancelled) setSupportedCollaterals([]);
      }
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

  const applyPolymarketImport = async (draft: PolymarketImportDraft) => {
    setTitle(draft.title);
    setDescription(draft.description);
    setEventMode(draft.eventMode);
    setOutcomes(
      draft.eventMode === "binary"
        ? (draft.outcomes.length >= 2 ? draft.outcomes.slice(0, 2) : ["Yes", "No"])
        : draft.outcomes.length >= 3
          ? draft.outcomes
          : withOtherOption(draft.outcomes.length ? draft.outcomes : ["Option 1", "Option 2"]),
    );
    setSlug(slugify(draft.slug || draft.title));
    setSlugManual(Boolean(draft.slug));
    setResolutionSources(
      [
        { label: "Polymarket", url: draft.sourceUrl },
        ...resolutionSources.filter(
          (s) => s.url.trim() && s.url.trim() !== draft.sourceUrl,
        ),
      ].slice(0, 5),
    );

    if (draft.suggestedResolveAfterAt) {
      setResolveAfterAt(draft.suggestedResolveAfterAt);
    }
    if (draft.suggestedStakeEndAt) {
      setStakeEndAt(draft.suggestedStakeEndAt);
    }

    if (draft.imageUrl) {
      const imgRes = await fetch(
        `/api/polymarket/image?url=${encodeURIComponent(draft.imageUrl)}`,
        { cache: "no-store" },
      );
      if (!imgRes.ok) {
        throw new Error("Imported details, but could not download the cover image.");
      }
      const blob = await imgRes.blob();
      const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const file = new File([blob], `polymarket-cover.${ext}`, {
        type: blob.type || "image/jpeg",
      });
      setImageFile(file);
      setImageUri("");
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const previewResolveLabel = useMemo(
    () => formatMarketCardDate(resolveAfterAt),
    [resolveAfterAt],
  );

  useEffect(() => {
    if (!publicClient || !factoryDeployed) return;
    let cancelled = false;
    void (async () => {
      try {
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
      } catch {
        if (!cancelled) setFeeds([]);
      }
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

  const seedOutcomeCount = useMemo(() => {
    if (marketKind === "pons") return (ponsDraft?.outcomes ?? []).filter((o) => o.trim()).length;
    if (marketKind === "event") return outcomes.map((o) => o.trim()).filter(Boolean).length;
    return 2;
  }, [marketKind, ponsDraft?.outcomes, outcomes]);

  const seedQuickAmounts = useMemo(
    () => buildSeedQuickAmounts(collateral.decimals, seedOutcomeCount, minSeedAmount),
    [collateral.decimals, seedOutcomeCount, minSeedAmount],
  );

  // Keep seed amount divisible when outcome count / collateral changes.
  useEffect(() => {
    if (seedOutcomeCount <= 0 || seedQuickAmounts.length === 0) return;
    try {
      const units = parseUnits(seedAmount || "0", collateral.decimals);
      if (units > BigInt(0) && units % BigInt(seedOutcomeCount) === BigInt(0)) return;
    } catch {
      // fall through to first suggestion
    }
    setSeedAmount(seedQuickAmounts[0]!);
  }, [seedOutcomeCount, collateral.decimals, seedQuickAmounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveTitle = useMemo(
    () =>
      marketKind === "pons"
        ? (ponsDraft?.title ?? "")
        : marketKind === "price"
          ? generatedPricePrompt
          : title,
    [generatedPricePrompt, marketKind, title, ponsDraft?.title],
  );

  // Auto-generate slug from title/prompt unless user has manually edited it
  useEffect(() => {
    if (slugManual) return;
    const source =
      marketKind === "pons"
        ? (ponsDraft?.title ?? "")
        : marketKind === "price"
          ? generatedPricePrompt
          : title;
    setSlug(slugify(source));
  }, [title, generatedPricePrompt, marketKind, slugManual, ponsDraft?.title]);

  // Duplicate / reserved slug check
  useEffect(() => {
    const normalized = slugify(slug);
    if (!normalized) {
      setSlugAvailable(null);
      setSlugCheckMessage("");
      setSlugCheckBusy(false);
      return;
    }
    if (isReservedMarketSlug(normalized)) {
      setSlugAvailable(false);
      setSlugCheckMessage("This slug can’t be used (looks like a wallet address).");
      setSlugCheckBusy(false);
      return;
    }
    let cancelled = false;
    setSlugCheckBusy(true);
    const t = window.setTimeout(() => {
      void fetch(`/api/market/slug?slug=${encodeURIComponent(normalized)}`, { cache: "no-store" })
        .then(async (res) => {
          const j = (await res.json()) as {
            available?: boolean;
            reason?: string;
            title?: string | null;
          };
          if (cancelled) return;
          const ok = Boolean(j.available);
          setSlugAvailable(ok);
          if (ok) setSlugCheckMessage("Slug is available.");
          else if (j.reason === "reserved") setSlugCheckMessage("This slug is reserved.");
          else setSlugCheckMessage(j.title ? `Already used by “${j.title}”.` : "Slug already taken.");
        })
        .catch(() => {
          if (!cancelled) {
            setSlugAvailable(null);
            setSlugCheckMessage("Could not verify slug uniqueness.");
          }
        })
        .finally(() => {
          if (!cancelled) setSlugCheckBusy(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [slug]);

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
      marketKind === "event" || marketKind === "pons"
        ? (marketKind === "pons"
            ? (ponsDraft?.outcomes ?? [])
            : outcomes.map((o) => o.trim()).filter(Boolean)
          ).length
        : 2;
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
        `Amount must divide evenly across ${nOutcomes} outcomes. Pick a chip below or use ${fixLabel} ${collateral.symbol}.`,
      );
      return false;
    }
    setSeedValidationError("");
    return true;
  };

  const handleCreateMarket = async () => {
    if (!validateSeedAmount()) return;
    if (!address || !publicClient) {
      setSubmitStatus("Connect wallet first.");
      return;
    }
    if (chainId !== DEPLOYMENT_CHAIN_ID) {
      setSubmitStatus(wrongNetworkMessage());
      return;
    }
    if (!factoryDeployed) {
      setSubmitStatus(undeployedStackMessage());
      return;
    }

    const cleanedThreshold = threshold.replaceAll(",", "").trim();
    const cleanOutcomes =
      marketKind === "event" || marketKind === "pons"
        ? marketKind === "pons"
          ? (ponsDraft?.outcomes ?? [])
          : outcomes.map((o) => o.trim()).filter(Boolean)
        : ["YES", "NO"];
    if (cleanOutcomes.length < 2) {
      setSubmitStatus("Add at least 2 outcomes.");
      return;
    }

    if (marketKind === "event" || marketKind === "pons") {
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

      if (USE_FPMM && collateral.isNative) {
        setSubmitStatus(`FPMM markets require an ERC20 collateral (e.g. USDG or USDC), not native ${NATIVE_CURRENCY_SYMBOL}.`);
        return;
      }

      const collateralSupported = (await publicClient.readContract({
        address: FACTORY_ADDRESS,
        abi: ACTIVE_FACTORY_ABI,
        functionName: "isSupportedCollateral",
        args: [collateral.address],
      })) as boolean;
      if (!collateralSupported) {
        setSubmitStatus(
          `${collateral.symbol} is not whitelisted for Zedkr markets yet. Choose USDG or USDC.`,
        );
        return;
      }

      const metadataHash = keccak256(toBytes(metadataUri || "ipfs://pending"));
      const minSeed = minSeedUnits;

      if (!metadataUri.trim()) {
        setSubmitStatus("Metadata is missing. Go back and upload market details again.");
        return;
      }

      const nOutcomes = cleanOutcomes.length;
      if (!USE_FPMM && nOutcomes > 0 && seedUnits % BigInt(nOutcomes) !== BigInt(0)) {
        const fix = nextDivisibleTotal(seedUnits, nOutcomes);
        const fixLabel = formatUnits(fix, collateral.decimals);
        setSubmitStatus(
          `Seed must divide evenly by ${nOutcomes} outcomes. Try ${fixLabel} ${collateral.symbol}.`,
        );
        return;
      }

      const fundingHint = Array.from({ length: nOutcomes }, () => BigInt(1));
      const fpmmBaseParams = {
        collateralToken: collateral.address,
        collateralDecimals: collateral.decimals,
        stakeEndTimestamp: stakeTs,
        resolveAfterTimestamp: resolveTs,
        metadataHash,
        outcomeLabels: cleanOutcomes,
        metadataURI: metadataUri,
        minInitialFunding: minSeed,
        initialFunding: seedUnits,
        fundingHint,
        shareRecipient: address,
      };
      const sharedParams = USE_FPMM
        ? fpmmBaseParams
        : {
            collateralToken: collateral.address,
            collateralDecimals: collateral.decimals,
            virtualReserve: seedUnits,
            stakeEndTimestamp: stakeTs,
            resolveAfterTimestamp: resolveTs,
            metadataHash,
            outcomeLabels: cleanOutcomes,
            metadataURI: metadataUri,
            minBootstrapTotal: minSeed,
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
              `Need ~${formatUnits(approveGasLimit, 18)} ${NATIVE_CURRENCY_SYMBOL} for approval gas. You have ${formatUnits(monBalance, 18)} ${NATIVE_CURRENCY_SYMBOL} on ${DEPLOYMENT_NETWORK_LABEL}.`,
            );
            return;
          }

          const approveHash = await writeContract({
            address: collateral.address,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [FACTORY_ADDRESS, seedUnits],
            account: address,
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
        fn: "createEventMarket" | "createPriceMarket" | "createNadTokenMarket" | "createPonsMarket",
        args: readonly unknown[],
        value?: bigint,
      ) => {
        const estimated = await publicClient.estimateContractGas({
          address: FACTORY_ADDRESS,
          abi: ACTIVE_FACTORY_ABI,
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
          `Insufficient ${NATIVE_CURRENCY_SYMBOL} on ${DEPLOYMENT_NETWORK_LABEL}. Need ~${need} ${NATIVE_CURRENCY_SYMBOL} (${seedLabel} seed + ~${gasLabel} gas). You have ${have} ${NATIVE_CURRENCY_SYMBOL}.`,
        );
        return false;
      };

      if (marketKind === "event") {
        const eventArgs = USE_FPMM ? [fpmmBaseParams] : [{ ...sharedParams }] as const;

        await publicClient.simulateContract({
          address: FACTORY_ADDRESS,
          abi: ACTIVE_FACTORY_ABI,
          functionName: "createEventMarket",
          args: eventArgs as never,
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
        createHash = await writeContract({
          address: FACTORY_ADDRESS,
          abi: ACTIVE_FACTORY_ABI,
          functionName: "createEventMarket",
          args: eventArgs as never,
          account: address,
          value: collateral.isNative ? seedUnits : undefined,
          gas: eventGas,
        });
      } else if (marketKind === "pons") {
        const ponsFn = USE_FPMM ? "createPonsMarket" : "createNadTokenMarket";
        const ponsArgs = USE_FPMM ? [fpmmBaseParams] : [{ ...sharedParams }] as const;

        await publicClient.simulateContract({
          address: FACTORY_ADDRESS,
          abi: ACTIVE_FACTORY_ABI,
          functionName: ponsFn,
          args: ponsArgs as never,
          account: address,
          value: collateral.isNative ? seedUnits : undefined,
        });

        setSubmitStatus("Creating Pons market and seeding liquidity...");
        const ponsGas = await estimateCreateGas(
          ponsFn,
          ponsArgs,
          collateral.isNative ? seedUnits : undefined,
        );
        if (collateral.isNative && !(await assertNativeMonAffordable(seedUnits, ponsGas))) {
          return;
        }
        createHash = await writeContract({
          address: FACTORY_ADDRESS,
          abi: ACTIVE_FACTORY_ABI,
          functionName: ponsFn,
          args: ponsArgs as never,
          account: address,
          value: collateral.isNative ? seedUnits : undefined,
          gas: ponsGas,
        });
      } else {
        if (!feed?.assetKey) {
          setSubmitStatus("No registered price feed for this asset on the factory.");
          return;
        }
        const priceArgs = USE_FPMM
          ? ([
              {
                base: fpmmBaseParams,
                priceAssetKey: feed.assetKey,
                priceThreshold: parseUnits(cleanedThreshold || "0", 8),
                priceKind: (comparison === "ABOVE" ? 0 : 1) as 0 | 1,
                priceUpperBound: BigInt(0),
                maxPriceStaleness: BigInt(3600),
                priceBinLower: [] as readonly bigint[],
                priceBinUpper: [] as readonly bigint[],
              },
            ] as const)
          : ([
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
            ] as const);

        await publicClient.simulateContract({
          address: FACTORY_ADDRESS,
          abi: ACTIVE_FACTORY_ABI,
          functionName: "createPriceMarket",
          args: priceArgs as never,
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
        createHash = await writeContract({
          address: FACTORY_ADDRESS,
          abi: ACTIVE_FACTORY_ABI,
          functionName: "createPriceMarket",
          args: priceArgs as never,
          account: address,
          value: collateral.isNative ? seedUnits : undefined,
          gas: priceGas,
        });
      }

      const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
      let createdMarket = "";
      for (const log of createReceipt.logs) {
        if (log.address.toLowerCase() !== FACTORY_ADDRESS.toLowerCase()) continue;
        try {
          const parsed = decodeEventLog({
            abi: ACTIVE_FACTORY_ABI,
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
    const isPons = marketKind === "pons";
    const imageToUse = isPons
      ? ponsDraft?.coverImageUrl ?? ""
      : imageUriForMetadata || imageUri;
    if (!imageToUse && !isPons) {
      throw new Error("Upload a cover image first so metadata includes image IPFS URI.");
    }
    const ponsTitle = isPons ? ponsDraft?.title ?? "" : effectiveTitle;
    const ponsOutcomes = isPons ? (ponsDraft?.outcomes ?? ["Yes", "No"]) : outcomes;
    const metadata = {
      title: ponsTitle,
      description: isPons ? (ponsDraft?.description ?? description) : description,
      marketKind: isPons ? "pons" : marketKind,
      eventMode: marketKind === "event" ? eventMode : isPons ? (ponsDraft?.ponsMarket.mode === "comparison" ? "multiple" : "binary") : null,
      question: marketKind === "price" ? generatedPricePrompt : ponsTitle,
      categories: isPons ? ["Crypto"] : selectedCategories,
      slug: slug || (isPons ? ponsDraft?.slug : undefined) || slugify(effectiveTitle),
      outcomes: ponsOutcomes,
      image: imageToUse || null,
      ponsMarket: isPons ? ponsDraft?.ponsMarket : undefined,
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
      resolution: marketKind === "event" ? "community-3-of-10-admins" : isPons ? "pons-bot-admin" : null,
      resolutionSources: isPons
        ? ponsDraft?.resolutionSources ?? []
        : marketKind === "event"
          ? sanitizeResolutionSourcesForMetadata(resolutionSources)
          : [],
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
    const isPons = marketKind === "pons";
    const errors: string[] = [];
    if (isPons) {
      if (!ponsDraft) errors.push("Load Pons token(s) and complete the form.");
      if (ponsDuplicateBlocked) errors.push("Duplicate market exists for this question and resolve time.");
    } else if (marketKind === "event" && !title.trim()) {
      errors.push("Title is required.");
    }
    if (!factoryDeployed) errors.push(undeployedStackMessage());
    if (!isPons && !description.trim()) errors.push("Description is required.");
    if (!isPons && marketKind === "event") {
      const validSources = sanitizeResolutionSourcesForMetadata(resolutionSources);
      if (validSources.length === 0) {
        errors.push("Add at least one resolution source URL (https://…) for event markets.");
      }
    }
    const filledOutcomes = isPons
      ? (ponsDraft?.outcomes ?? [])
      : outcomes.map((o) => o.trim()).filter(Boolean);
    if (filledOutcomes.length < 2) errors.push("At least 2 outcome labels are required.");
    if (!isPons && outcomes.some((o) => !o.trim())) errors.push("All outcome labels must be filled in.");
    if (!stakeEndAt) errors.push("Stake end time is required.");
    if (!resolveAfterAt) errors.push("Resolve after time is required.");
    if (!slug.trim()) errors.push("Vanity slug is required.");
    else if (isReservedMarketSlug(slug)) errors.push("Choose a different vanity slug.");
    else if (slugAvailable === false) errors.push("That vanity slug is already taken.");
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
    if (isPons && ponsDraft?.ponsMarket) {
      const ponsResolveErr = validatePonsResolveAfter(ponsDraft.ponsMarket.questionType, Math.floor(resolveTs / 1000));
      if (ponsResolveErr) {
        setTimeValidationError(ponsResolveErr);
        return;
      }
    }
    setTimeValidationError("");

    if (isPons) {
      setIsNextLoading(true);
      setUploadState("");
      try {
        await uploadMetadata();
        setStep("seed");
      } catch (err) {
        setUploadState(err instanceof Error ? err.message : "Could not prepare metadata.");
      } finally {
        setIsNextLoading(false);
      }
      return;
    }

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
            <h1 className={`text-xl tracking-tight md:text-3xl ${brandSectionHeading}`}>Create market</h1>
          </div>
          {!factoryDeployed ? (
            <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {undeployedStackMessage()}
            </p>
          ) : null}
        </div>

        <div className="min-w-0 space-y-0 divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {step === "details" ? (
            <>
          <section className="py-8">
            <p className={labelClass}>Market type</p>
            <div className="mt-4 flex flex-wrap gap-x-7 gap-y-3">
              {(
                [
                  { id: "event" as const, label: "Event (community)" },
                  { id: "price" as const, label: "Price (oracle)" },
                  { id: "pons" as const, label: "Ponsfamily Market", logo: "/pons.png" },
                ] as const
              ).map((opt) => {
                const { id, label } = opt;
                const active = marketKind === id;
                const logo = "logo" in opt ? opt.logo : null;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMarketKind(id)}
                    className="group inline-flex items-center gap-2.5 text-sm transition"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition ${
                        active
                          ? "border-emerald-500"
                          : "border-[var(--border)] group-hover:border-[var(--muted)]"
                      }`}
                    >
                      {active ? <span className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
                    </span>
                    {logo ? (
                      <img src={logo} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
                    ) : null}
                    <span
                      className={
                        active
                          ? "font-medium text-[var(--foreground)]"
                          : "text-[var(--muted)] group-hover:text-[var(--foreground)]"
                      }
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {marketKind === "pons" ? (
            <PonsMarketCreateSection
              stakeEndAt={stakeEndAt}
              resolveAfterAt={resolveAfterAt}
              slug={slug}
              questionType={ponsQuestionType}
              onQuestionTypeChange={(type) => {
                setPonsQuestionType(type);
                writeCreateQuery("pons", type);
              }}
              onSlugChange={(s, manual) => {
                setSlug(s);
                if (manual) setSlugManual(true);
              }}
              onDraftChange={setPonsDraft}
              onDuplicateBlock={setPonsDuplicateBlocked}
            />
          ) : marketKind === "event" ? (
            <>
            <section className="py-8">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className={labelClass} htmlFor="title">
                  Title
                </label>
                <button
                  type="button"
                  onClick={() => setPolyImportOpen(true)}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
                >
                  Import from Polymarket
                </button>
              </div>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={`${fieldClass} mt-2`}
                placeholder="Short market title"
              />
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                Optional: paste a Polymarket link to autofill title, description, cover, and outcomes.
              </p>
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
            <label className={labelClass} htmlFor="slug">
              Vanity URL slug
            </label>
            <div className="mt-2 flex overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] focus-within:border-[var(--accent)]">
              <span className="flex items-center border-r border-[var(--border)] bg-[var(--card)] px-3 text-xs text-[var(--muted)] whitespace-nowrap select-none">
                {marketSlugPrefixLabel()}
              </span>
              <input
                id="slug"
                value={slug}
                onChange={(e) => {
                  setSlug(slugify(e.target.value));
                  setSlugManual(true);
                }}
                className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm font-mono text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
                placeholder="my-market-slug"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--muted)]">
              Auto-generated from the title. Edit to customise — must be unique.
            </p>
            {slug.trim() ? (
              <p
                className={`mt-1 text-[11px] ${
                  slugCheckBusy
                    ? "text-[var(--muted)]"
                    : slugAvailable === true
                      ? "text-emerald-500"
                      : slugAvailable === false
                        ? "text-red-400"
                        : "text-[var(--muted)]"
                }`}
              >
                {slugCheckBusy ? "Checking availability…" : slugCheckMessage}
              </p>
            ) : null}
          </section>

          {marketKind !== "pons" && (
          <section className="py-8">
            <label className={labelClass} htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${fieldClass} styled-scroll min-h-24 resize-y`}
              placeholder="Add a clear resolution description"
            />
          </section>
          )}

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
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] transition hover:underline"
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

          {marketKind !== "pons" && (
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
          )}

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

          {marketKind !== "pons" && (
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
          )}

          {marketKind === "pons" && ponsDraft && (
            <section className="py-8">
              <p className={`mb-2 text-xs uppercase tracking-wider text-[var(--muted)] ${brandSectionLabel}`}>
                Card preview
              </p>
              <div className="max-w-sm">
                <NadMarketListCard
                  title={ponsDraft.title}
                  nadMarket={ponsMarketForCardPreview(ponsDraft.ponsMarket)}
                  outcomeLabels={ponsDraft.outcomes}
                  previewTokenStats={ponsDraft.previewTokenStats?.map((s) => ponsStatsForCardPreview(s))}
                  resolveAfter={previewResolveLabel}
                  showNewBadge
                  interactive={false}
                />
              </div>
            </section>
          )}

          <section className="py-10">
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={goToSeedStep}
                disabled={
                  isNextLoading ||
                  slugAvailable === false ||
                  slugCheckBusy ||
                  (marketKind === "pons" && (!ponsDraft || ponsDuplicateBlocked))
                }
                className="rounded-full bg-white py-3.5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-60 sm:px-10 w-full sm:w-auto [html[data-theme=light]_&]:border [html[data-theme=light]_&]:border-black/15"
              >
                {isNextLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black" />
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
              <label className={labelClass} htmlFor="seed-amount">
                Seed liquidity
              </label>
              <div ref={collateralDropdownRef} className="relative mt-2 max-w-[360px]">
                <div className="flex items-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] focus-within:border-[var(--accent)]">
                  <input
                    id="seed-amount"
                    type="number"
                    min={Number.isFinite(minSeedAmount) ? minSeedAmount : 10}
                    step="any"
                    value={seedAmount}
                    onChange={(e) => {
                      setSeedAmount(e.target.value);
                      setSeedValidationError("");
                    }}
                    className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-base text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] sm:text-sm"
                    placeholder={
                      collateral.isNative
                        ? `Minimum ${MIN_MON_SEED} MON`
                        : `Minimum 10 ${collateral.symbol}`
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setIsCollateralDropdownOpen((v) => !v)}
                    className="mr-1.5 inline-flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
                    aria-label="Select collateral"
                    aria-expanded={isCollateralDropdownOpen}
                  >
                    <img
                      src={collateral.image}
                      alt=""
                      className="h-5 w-5 rounded-full object-cover"
                    />
                    <span>{collateral.symbol}</span>
                    <CaretDown size={14} weight="bold" className="text-[var(--muted)]" />
                  </button>
                </div>
                {isCollateralDropdownOpen && (
                  <div className="absolute right-0 z-30 mt-2 min-w-[14rem] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl">
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
                        <img src={opt.image} alt="" className="h-5 w-5 rounded-full object-cover" />
                        <span className="text-[var(--foreground)]">{opt.symbol}</span>
                        <span className="text-xs text-[var(--muted)]">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                {collateralBalanceLabel} {collateral.symbol}
              </p>
              {supportedCollaterals.length === 0 && (
                <p className="mt-2 text-xs text-amber-400">
                  Loading supported collateral from factory…
                </p>
              )}
              {seedQuickAmounts.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                  {seedQuickAmounts.map((amt) => {
                    const active = seedAmount === amt;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => {
                          setSeedAmount(amt);
                          setSeedValidationError("");
                        }}
                        className={`bg-transparent p-0 text-xs tabular-nums transition ${
                          active
                            ? "font-semibold text-[var(--foreground)]"
                            : "font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        {amt}
                      </button>
                    );
                  })}
                </div>
              )}
              {marketKind === "event" && (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  Event markets are resolved through protocol admins.
                </p>
              )}
              <p className="mt-3 text-xs text-[var(--muted)]">
                Creator share 0.6% (per trade){" "}
                <Link
                  href="/how-it-works#creators"
                  className="text-[var(--foreground)] underline underline-offset-2 transition hover:opacity-80"
                >
                  Learn more
                </Link>
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
                    className="inline-flex min-w-[10.5rem] items-center justify-center gap-2 rounded-full bg-emerald-600 px-8 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-80"
                  >
                    {isSubmittingMarket ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                        {createStageLabel(submitStatus)}
                      </>
                    ) : (
                      "Create market"
                    )}
                  </button>
                )}
              </div>
              {seedValidationError && (
                <p className="mt-3 text-xs text-red-400">{seedValidationError}</p>
              )}
              {submitStatus && !isCreateProgressStatus(submitStatus) && !isCreateComplete && (
                <p className="mt-3 text-sm font-semibold text-rose-400">
                  {submitStatus.replace(/^Error:\s*/i, "")}
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
      <PolymarketImportModal
        open={polyImportOpen}
        onClose={() => setPolyImportOpen(false)}
        onImport={applyPolymarketImport}
      />
    </AppLayout>
  );
}

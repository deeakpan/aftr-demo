"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import { useAccount, useDisconnect, useReadContract, useSignMessage } from "wagmi";
import { formatUnits, parseAbi } from "viem";
import { openParaModal, paraLogout } from "@/app/components/para-wallet-provider";
import { signOutEverywhere } from "@/lib/auth-signout";
import { isParaConfigured } from "@/lib/para-config";
import { useMe } from "@/lib/useMe";
import { DEPLOYMENT_CHAIN_ID } from "@/lib/deployment";
import { USDG_TOKEN_LOGO } from "@/lib/brand-assets";
import { tradingUsdgAddress } from "@/lib/usdg";
import {
  BookOpenText,
  Check,
  CircleNotch,
  Coins,
  CopySimple,
  DiamondsFour,
  Gear,
  Gift,
  Lifebuoy,
  List,
  MagnifyingGlass,
  PlusMinus,
  Rows,
  SignOut,
  Trophy,
} from "@phosphor-icons/react";
import { getParaWalletRecord } from "@/lib/para-wallet-record";
import {
  getCachedProfileName,
  getUserProfileByAddress,
  saveUserProfile,
  setCachedProfileName,
  useProfileName,
} from "@/lib/supabase/profiles";
import { SidebarDrawer } from "@/app/components/sidebar-drawer";
import { SidebarOpenContext } from "@/app/components/sidebar-context";
import { MarketSearchModal } from "@/app/components/market-search-modal";
import { DepositModal } from "@/app/components/deposit-modal";

export function buildWalletGradient(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  const palette = [210, 225, 245, 265, 285, 315, 335, 190];
  const baseIndex = Math.abs(hash) % palette.length;
  const hueA = palette[baseIndex];
  const hueB = palette[(baseIndex + 2) % palette.length];
  const hueC = palette[(baseIndex + 4) % palette.length];
  return `linear-gradient(135deg, hsl(${hueA} 75% 58%) 0%, hsl(${hueB} 72% 52%) 48%, hsl(${hueC} 78% 45%) 100%)`;
}

export function createSuggestedUsername(address: string) {
  // Deterministic — random suffixes made every reload look like a “reset”.
  const base = address.slice(2, 8).toLowerCase();
  return `trader_${base}`;
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatGroupedAmount(value: number, minimumFractionDigits: number, maximumFractionDigits: number) {
  if (!Number.isFinite(value)) return (0).toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits });
  return value.toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits });
}

function signedSessionKey(address: string) {
  return `aftrmarket-signed:${address.toLowerCase()}`;
}

/** Profile balance uses trading USDG (mock or real via NEXT_PUBLIC_USE_MOCK_USDG). */
const PROFILE_USDG_ADDRESS = tradingUsdgAddress() ?? undefined;
const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export type AppLayoutProps = {
  children: ReactNode;
  /** Trending / category strip above main content */
  showFilterStrip?: boolean;
  searchPlaceholder?: string;
  showSearch?: boolean;
  pageBackgroundClassName?: string;
  /** Lock main column to viewport height so child panes can scroll independently (e.g. market detail). */
  viewportLocked?: boolean;
};

export function AppLayout({
  children,
  showFilterStrip = false,
  searchPlaceholder = "Search markets... (Ctrl/Cmd + K)",
  showSearch = true,
  pageBackgroundClassName,
  viewportLocked = false,
}: AppLayoutProps) {
  const { open } = useWeb3Modal();
  const { address } = useAccount();
  const me = useMe();
  const sessionAddress = me ?? address;
  const cachedProfileName = useProfileName(sessionAddress);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [mounted, setMounted] = useState(false);
  const hasRunAuthRef = useRef("");
  const profileCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [nameModalError, setNameModalError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState("Trending");
  const [searchQuery, setSearchQuery] = useState("");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [profileName, setProfileName] = useState("");
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [isSavingProfileName, setIsSavingProfileName] = useState(false);
  /** `undefined` = still loading summary for connected wallet */
  const [walletGraphStats, setWalletGraphStats] = useState<
    | undefined
    | null
    | {
        marketCount: number;
        pnlUsd: string;
        winRatePct: number | null;
      }
  >(undefined);
  const { data: usdgBalanceRaw } = useReadContract({
    address: PROFILE_USDG_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: sessionAddress ? [sessionAddress] : undefined,
    chainId: DEPLOYMENT_CHAIN_ID,
    query: { enabled: Boolean(sessionAddress && PROFILE_USDG_ADDRESS) },
  });
  const { data: usdgDecimalsRaw } = useReadContract({
    address: PROFILE_USDG_ADDRESS,
    abi: ERC20_ABI,
    functionName: "decimals",
    chainId: DEPLOYMENT_CHAIN_ID,
    query: { enabled: Boolean(PROFILE_USDG_ADDRESS) },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep header name in sync with shared localStorage store across page remounts.
  useEffect(() => {
    if (!sessionAddress) {
      setProfileName("");
      return;
    }
    if (cachedProfileName) setProfileName(cachedProfileName);
  }, [sessionAddress, cachedProfileName]);

  useEffect(() => {
    if (!mounted || !sessionAddress) {
      hasRunAuthRef.current = "";
      return;
    }
    const authKey = sessionAddress.toLowerCase();
    if (hasRunAuthRef.current === authKey) return;
    hasRunAuthRef.current = authKey;

    const runPostConnectFlow = async () => {
      setProfileError(null);
      setNameModalError(null);

      // Para session: wait for wallet record when available, but never block profile hydrate.
      if (me) {
        const record = getParaWalletRecord();
        if (record && record.owner.toLowerCase() !== me.toLowerCase()) {
          hasRunAuthRef.current = "";
          return;
        }
      }

      if (!me) {
        const alreadySigned = window.localStorage.getItem(signedSessionKey(sessionAddress)) === "1";
        if (!alreadySigned) {
          try {
            const nonce = Math.floor(Math.random() * 1_000_000);
            await signMessageAsync({
              message: `Sign in to Zedkr Market\nAddress: ${sessionAddress}\nNonce: ${nonce}`,
            });
            window.localStorage.setItem(signedSessionKey(sessionAddress), "1");
          } catch {
            hasRunAuthRef.current = "";
            return;
          }
        }
      }

      const cachedName = getCachedProfileName(sessionAddress);
      if (cachedName) setProfileName(cachedName);

      let existingProfile: { address: string; name: string } | null = null;
      try {
        existingProfile = await getUserProfileByAddress(sessionAddress);
      } catch {
        // Supabase flaky — keep local name; only prompt if we have nothing.
        if (cachedName) {
          setProfileName(cachedName);
          return;
        }
        const suggested = createSuggestedUsername(sessionAddress);
        setProfileName(suggested);
        setCachedProfileName(sessionAddress, suggested);
        setNameInput(suggested);
        setShowNameModal(true);
        return;
      }

      if (existingProfile?.name) {
        setProfileName(existingProfile.name);
        setCachedProfileName(sessionAddress, existingProfile.name);
        return;
      }

      if (cachedName) {
        setProfileName(cachedName);
        void saveUserProfile({ address: sessionAddress, name: cachedName }).catch(() => {});
        return;
      }

      const suggested = createSuggestedUsername(sessionAddress);
      setNameInput(suggested);
      setProfileName(suggested);
      setCachedProfileName(sessionAddress, suggested);
      setShowNameModal(true);
    };
    void runPostConnectFlow();
  }, [sessionAddress, me, mounted, signMessageAsync]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (showSearch) setIsSearchOpen(true);
        return;
      }
      if (!typing && event.key === "/" && showSearch) {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSearch]);

  useEffect(() => {
    if (!showFilterStrip) return;
    const fromUrl = searchParams.get("filter") || "Trending";
    setActiveFilter(fromUrl);
    setSearchQuery(searchParams.get("q") ?? "");
  }, [showFilterStrip, searchParams]);

  const updateMarketQuery = (updates: Record<string, string | null>) => {
    if (!showFilterStrip || pathname !== "/market") return;
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (!v) next.delete(k);
      else next.set(k, v);
    });
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("aftrmarket-theme");
    const initialTheme = savedTheme === "light" ? "light" : "dark";
    setTheme(initialTheme);
    document.documentElement.setAttribute("data-theme", initialTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    window.localStorage.setItem("aftrmarket-theme", nextTheme);
  };

  const isWalletConnected = mounted && Boolean(sessionAddress);
  const profileBalance = useMemo(() => {
    const bal = (usdgBalanceRaw as bigint | undefined) ?? BigInt(0);
    const decimals = Number(usdgDecimalsRaw ?? 6);
    const value = Number(formatUnits(bal, decimals));
    return { amount: formatGroupedAmount(value, 2, 2), symbol: "USDG" };
  }, [usdgBalanceRaw, usdgDecimalsRaw]);

  const walletGraphSummary = useMemo(() => {
    if (walletGraphStats === undefined || walletGraphStats === null) return null;
    return {
      marketCount: walletGraphStats.marketCount,
      pnlUsd: typeof walletGraphStats.pnlUsd === "string" ? walletGraphStats.pnlUsd : "0.00",
      winRatePct:
        typeof walletGraphStats.winRatePct === "number" && Number.isFinite(walletGraphStats.winRatePct)
          ? walletGraphStats.winRatePct
          : null,
    };
  }, [walletGraphStats]);

  useEffect(() => {
    if (!sessionAddress) {
      setWalletGraphStats(undefined);
      return;
    }
    let cancelled = false;
    setWalletGraphStats(undefined);
    void fetch(`/api/wallet/subgraph-summary?wallet=${encodeURIComponent(sessionAddress)}`, { cache: "no-store" })
      .then(async (res) => {
        const j = (await res.json()) as {
          marketCount?: number;
          pnlUsd?: string;
          winRatePct?: number | null;
          error?: string;
        };
        if (!res.ok) throw new Error(j.error || "Subgraph summary failed");
        if (cancelled) return;
        setWalletGraphStats({
          marketCount: typeof j.marketCount === "number" ? j.marketCount : 0,
          pnlUsd: typeof j.pnlUsd === "string" ? j.pnlUsd : "0.00",
          winRatePct:
            typeof j.winRatePct === "number" && Number.isFinite(j.winRatePct) ? j.winRatePct : null,
        });
      })
      .catch(() => {
        if (!cancelled) setWalletGraphStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionAddress]);
  const displayProfileName =
    profileName ||
    cachedProfileName ||
    (sessionAddress ? createSuggestedUsername(sessionAddress) : "");

  const walletGradient = useMemo(
    () => (sessionAddress ? buildWalletGradient(sessionAddress) : "linear-gradient(135deg, #3f3f46, #18181b)"),
    [sessionAddress],
  );

  const scheduleProfileClose = () => {
    if (profileCloseTimerRef.current) clearTimeout(profileCloseTimerRef.current);
    profileCloseTimerRef.current = setTimeout(() => {
      setIsEditingProfileName(false);
      setIsProfileOpen(false);
    }, 180);
  };

  const openProfilePopover = () => {
    if (profileCloseTimerRef.current) clearTimeout(profileCloseTimerRef.current);
    setIsProfileOpen(true);
  };

  const submitProfileName = async () => {
    if (!sessionAddress || isSavingProfileName) return;
    if (!isEditingProfileName) {
      setProfileNameDraft(displayProfileName || createSuggestedUsername(sessionAddress));
      setProfileError(null);
      setIsEditingProfileName(true);
      return;
    }
    setIsSavingProfileName(true);
    setProfileError(null);
    try {
      const finalName = profileNameDraft.trim() || createSuggestedUsername(sessionAddress);
      setCachedProfileName(sessionAddress, finalName);
      setProfileName(finalName);
      setIsEditingProfileName(false);
      try {
        await saveUserProfile({ address: sessionAddress, name: finalName });
      } catch {
        // Name already cached locally; ignore flaky Supabase sync.
      }
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not update profile name.");
    } finally {
      setIsSavingProfileName(false);
    }
  };

  useEffect(() => {
    return () => {
      if (profileCloseTimerRef.current) clearTimeout(profileCloseTimerRef.current);
    };
  }, []);

  return (
    <SidebarOpenContext.Provider value={isSidebarOpen}>
      <main
        className={`mx-auto flex w-full flex-col overflow-x-hidden ${
          viewportLocked
            ? "h-dvh max-h-dvh min-h-0 overflow-hidden py-0 pb-24 md:pb-0"
            : "min-h-screen py-4 pb-24 md:pb-4"
        } ${pageBackgroundClassName ?? "bg-[var(--background)]"}`}
      >
        <SidebarDrawer
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          theme={theme}
        />

        <div
          className={`flex min-w-0 flex-1 flex-col ${viewportLocked ? "relative min-h-0 overflow-hidden" : ""}`}
        >
        <header
          className={`z-30 w-full shrink-0 px-3 md:px-6 ${
            viewportLocked
              ? "sticky top-0 mb-0 bg-[var(--background)]/95 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-[var(--background)]/80"
              : "mb-1 py-3"
          }`}
        >
          <div className="flex items-center gap-2 md:gap-3">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setIsSidebarOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--foreground)]"
            >
              <List size={24} weight="bold" />
            </button>
            <Link href="/" className="relative block h-9 w-9 shrink-0">
              <Image
                src={theme === "light" ? "/light.png" : "/logo.png"}
                alt="Zedkr Market home"
                fill
                className="object-contain object-center"
                sizes="36px"
                priority
              />
            </Link>
            {showSearch ? (
              <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                className="flex h-11 w-[min(100%,26rem)] max-w-[26rem] items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-left text-sm text-[var(--muted)] transition hover:border-white/15"
              >
                <MagnifyingGlass size={16} weight="bold" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">Search markets</span>
                <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">/</span>
              </button>
            ) : null}
            <div className="min-w-0 flex-1" />
            <div className="flex shrink-0 items-center justify-end gap-2 md:gap-3">
              {isWalletConnected ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowDepositModal(true)}
                    className="inline-flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-white caret-transparent hover:brightness-110"
                    style={{
                      background: "linear-gradient(180deg, #3a3a3a 0%, #111111 48%, #000000 100%)",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.28), 0 0 0 1px rgba(196, 210, 224, 0.55), 0 1px 2px rgba(0,0,0,0.45)",
                    }}
                  >
                    <Coins size={14} weight="fill" />
                    Deposit
                  </button>
                  <div
                    className="relative flex items-center gap-2"
                    onMouseEnter={openProfilePopover}
                    onMouseLeave={scheduleProfileClose}
                  >
                    {displayProfileName ? (
                      <span className="hidden max-w-[7.5rem] truncate text-sm font-medium text-[var(--foreground)] sm:inline">
                        {displayProfileName}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Open profile"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={openProfilePopover}
                      style={{
                        backgroundImage: walletGradient,
                        borderColor: theme === "light" ? "rgba(11, 12, 14, 0.2)" : "rgba(255, 255, 255, 0.7)",
                      }}
                      className="h-9 w-9 shrink-0 cursor-pointer select-none rounded-full border-2 shadow-sm caret-transparent outline-none focus-visible:ring-2 focus-visible:ring-white/25 md:h-10 md:w-10"
                    >
                      <span className="sr-only">Open profile</span>
                    </button>
                    {isProfileOpen && (
                      <aside
                        onMouseEnter={openProfilePopover}
                        onMouseLeave={scheduleProfileClose}
                        className="absolute right-2 top-full z-[60] mt-2 w-[min(92vw,268px)] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-2xl"
                      >
                        <div className="mb-2 flex items-center pb-1">
                          <h3 className="text-sm font-semibold">Profile</h3>
                        </div>
                        <div className="flex items-start gap-2">
                          <div
                            style={{
                              backgroundImage: walletGradient,
                              borderColor: theme === "light" ? "rgba(11, 12, 14, 0.2)" : "rgba(255, 255, 255, 0.7)",
                            }}
                            className="h-9 w-9 shrink-0 rounded-full border-2"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              {isEditingProfileName ? (
                                <input
                                  value={profileNameDraft}
                                  autoFocus
                                  onChange={(e) => {
                                    setProfileNameDraft(e.target.value);
                                    setProfileError(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      void submitProfileName();
                                    }
                                  }}
                                  className="h-7 w-[112px] border border-[var(--border)] bg-[var(--surface)] px-2 text-xs outline-none focus:border-[var(--accent)]"
                                  maxLength={40}
                                />
                              ) : (
                                <p className="truncate text-xs font-semibold text-[var(--foreground)]">
                                  {displayProfileName || "-"}
                                </p>
                              )}
                              <button
                                type="button"
                                disabled={isSavingProfileName}
                                onClick={() => void submitProfileName()}
                                className="inline-flex h-7 w-7 shrink-0 cursor-pointer select-none items-center justify-center border border-[var(--border)] text-[var(--muted)] caret-transparent hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-60"
                                aria-label={
                                  isSavingProfileName
                                    ? "Saving username"
                                    : isEditingProfileName
                                      ? "Confirm username"
                                      : "Edit username"
                                }
                              >
                                {isSavingProfileName ? (
                                  <CircleNotch size={12} weight="bold" className="animate-spin" />
                                ) : isEditingProfileName ? (
                                  <Check size={12} weight="bold" />
                                ) : (
                                  <Gear size={12} />
                                )}
                              </button>
                            </div>
                            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                              <span>{sessionAddress ? shortenAddress(sessionAddress) : "-"}</span>
                              {sessionAddress && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(sessionAddress);
                                    } catch {
                                      setProfileError("Could not copy wallet address.");
                                    }
                                  }}
                                  className="ml-1.5 inline-flex align-middle text-[var(--muted)] hover:text-[var(--foreground)]"
                                  aria-label="Copy wallet address"
                                >
                                  <CopySimple size={11} weight="bold" />
                                </button>
                              )}
                            </p>
                            {profileError && (
                              <p className="mt-1 text-[10px] leading-snug text-red-400">{profileError}</p>
                            )}
                          </div>
                        </div>
                        <div className="my-2 border-t border-[var(--border)]" />
                        <div className="mt-2 space-y-0.5">
                          <p className="py-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                            Balance
                          </p>
                          <div className="mb-1 flex items-center gap-2 px-1 py-0.5 text-xs text-[var(--foreground)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={USDG_TOKEN_LOGO}
                              alt=""
                              width={16}
                              height={16}
                              className="h-4 w-4 shrink-0 rounded-full"
                            />
                            <span className="tabular-nums">
                              {profileBalance.amount} {profileBalance.symbol}
                            </span>
                          </div>
                          <p className="py-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">Profile stats</p>
                          {walletGraphStats === undefined ? (
                            <p className="pb-2 text-xs text-[var(--muted)]">Loading…</p>
                          ) : walletGraphSummary ? (
                            <div className="pb-2 space-y-1 text-[11px] leading-snug text-[var(--foreground)]">
                              <p>
                                Markets:{" "}
                                <span className="font-semibold tabular-nums">{walletGraphSummary.marketCount}</span>
                              </p>
                              <div className="flex items-center justify-between gap-3">
                                <p>
                                  PnL:{" "}
                                  <span
                                    className={`font-semibold tabular-nums ${
                                      walletGraphSummary.pnlUsd.startsWith("-")
                                        ? "text-[var(--outcome-no)]"
                                        : "text-[var(--outcome-yes)]"
                                    }`}
                                  >
                                    ${walletGraphSummary.pnlUsd}
                                  </span>
                                </p>
                                <p>
                                  Win rate:{" "}
                                  <span className="font-semibold tabular-nums text-[var(--muted)]">
                                    {walletGraphSummary.winRatePct === null ? "—" : `${walletGraphSummary.winRatePct}%`}
                                  </span>
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="pb-2 text-xs text-[var(--muted)]">Indexer unavailable.</p>
                          )}
                          {[
                            { label: "Trades", Icon: PlusMinus, iconClass: "text-[#7fd0ff]" },
                            { label: "Rewards", Icon: Trophy, iconClass: "text-[#ffbf47]" },
                            { label: "Help Center", Icon: Lifebuoy, iconClass: "text-[#68e0a0]" },
                            { label: "Documentation", Icon: BookOpenText, iconClass: "text-[#d8a3ff]" },
                            { label: "Refer to Earn", Icon: Gift, iconClass: "text-[#ff8ca8]" },
                          ].map(({ label, Icon, iconClass }) => (
                            <button
                              key={label}
                              type="button"
                              className="flex w-full items-center justify-between px-1 py-1.5 text-left text-xs text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                            >
                              <span className="inline-flex items-center gap-2">
                                <Icon size={13} weight="fill" className={iconClass} />
                                {label}
                              </span>
                              <span>›</span>
                            </button>
                          ))}
                        </div>
                        <div className="mt-1 flex w-full items-center justify-between px-1 py-1.5 text-xs text-[var(--foreground)]">
                          <span>Dark mode</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={theme === "dark"}
                            onClick={toggleTheme}
                            className={`relative h-5 w-9 rounded-full border transition ${
                              theme === "dark"
                                ? "border-[var(--accent)] bg-[var(--accent)]"
                                : "border-[var(--border)] bg-[var(--surface)]"
                            }`}
                            aria-label="Toggle dark mode"
                          >
                            <span
                              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition ${
                                theme === "dark" ? "left-4" : "left-0.5"
                              }`}
                            />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void signOutEverywhere(() => paraLogout());
                            disconnect();
                            setIsProfileOpen(false);
                            setProfileName("");
                            setShowDepositModal(false);
                          }}
                          className="mt-1 flex w-full items-center justify-between px-1 py-1.5 text-left text-xs font-medium text-red-400 transition hover:bg-red-900/20 hover:text-red-300"
                        >
                          <span>Logout</span>
                          <SignOut size={14} />
                        </button>
                      </aside>
                    )}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (isParaConfigured()) {
                      openParaModal();
                      return;
                    }
                    void open({ view: "Connect" }).catch((error) => {
                      console.error("Failed to open wallet modal", error);
                    });
                  }}
                  className="inline-flex h-11 cursor-pointer select-none items-center rounded-full bg-[var(--foreground)] px-5 text-sm font-semibold text-[var(--background)] caret-transparent hover:opacity-90"
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
        </header>

        {showFilterStrip && (
          <div className="no-scrollbar mb-5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-3 md:px-6">
            <div className="flex min-w-max items-end gap-6 border-b border-[var(--border)]">
              {[
                "Trending",
                "Newest",
                "Crypto",
                "Politics",
                "Finance",
                "Tech",
                "Economy",
                "Sports",
                "Gaming",
                "Entertainment",
                "Breaking",
              ].map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => {
                    setActiveFilter(filter);
                    updateMarketQuery({ filter });
                  }}
                  className={`relative pb-2.5 text-sm transition ${
                    activeFilter === filter
                      ? "font-semibold text-[var(--foreground)]"
                      : "font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        )}

        {viewportLocked ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        ) : (
          children
        )}
      </div>

      <nav className="mobile-bottom-nav pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 md:hidden">
        <div className="pointer-events-auto mx-auto mb-[max(0.75rem,env(safe-area-inset-bottom,0px))] flex max-w-md items-stretch gap-1 rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 p-1.5 shadow-[0_12px_40px_rgb(0_0_0_/_0.35)] backdrop-blur-md [html[data-theme=light]_&]:bg-white/95 [html[data-theme=light]_&]:shadow-[0_12px_32px_rgb(23_18_42_/_0.12)]">
          <Link
            href="/"
            className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2.5 text-[10px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            <Rows size={18} weight="regular" />
            <span>Markets</span>
          </Link>
          <Link
            href="/create"
            className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2.5 text-[10px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            <DiamondsFour size={18} weight="regular" />
            <span>Create</span>
          </Link>
          <Link
            href="/trades"
            className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2.5 text-[10px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            <PlusMinus size={18} weight="regular" />
            <span>Trades</span>
          </Link>
        </div>
      </nav>

      {showDepositModal && sessionAddress ? (
        <DepositModal address={sessionAddress} onClose={() => setShowDepositModal(false)} />
      ) : null}

      {showNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h3 className="text-lg font-semibold">Choose a display name</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Set your name to participate in market activity.
            </p>
            <input
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                setNameModalError(null);
              }}
              className="mt-4 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm outline-none focus:border-[var(--accent)]"
              placeholder="Enter your name"
              maxLength={40}
            />
            {nameModalError && (
              <p className="mt-2 text-sm text-red-400">{nameModalError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!sessionAddress) return;
                  setIsSavingName(true);
                  setNameModalError(null);
                  try {
                    const fallbackName = nameInput.trim() || createSuggestedUsername(sessionAddress);
                    setCachedProfileName(sessionAddress, fallbackName);
                    setProfileName(fallbackName);
                    setShowNameModal(false);
                    try {
                      await saveUserProfile({ address: sessionAddress, name: fallbackName });
                    } catch {
                      // Local name kept; Supabase may catch up later.
                    }
                  } catch (error) {
                    setNameModalError(
                      error instanceof Error ? error.message : "Could not save profile name.",
                    );
                  } finally {
                    setIsSavingName(false);
                  }
                }}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
              >
                Later
              </button>
              <button
                type="button"
                disabled={isSavingName}
                onClick={async () => {
                  if (!sessionAddress) return;
                  setIsSavingName(true);
                  setNameModalError(null);
                  try {
                    const fallbackName = nameInput.trim() || createSuggestedUsername(sessionAddress);
                    setCachedProfileName(sessionAddress, fallbackName);
                    setProfileName(fallbackName);
                    setShowNameModal(false);
                    try {
                      await saveUserProfile({ address: sessionAddress, name: fallbackName });
                    } catch {
                      // Name already cached locally; ignore flaky Supabase sync.
                    }
                  } catch (error) {
                    setNameModalError(
                      error instanceof Error ? error.message : "Could not save profile name.",
                    );
                  } finally {
                    setIsSavingName(false);
                  }
                }}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSavingName ? "Saving..." : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showSearch && (
        <MarketSearchModal
          open={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          initialQuery={searchQuery}
          onQueryChange={
            showFilterStrip
              ? (q) => {
                  setSearchQuery(q);
                  updateMarketQuery({ q: q.trim() ? q : null });
                }
              : undefined
          }
        />
      )}
      </main>
    </SidebarOpenContext.Provider>
  );
}

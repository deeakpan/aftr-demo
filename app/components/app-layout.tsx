"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import { useAccount, useBalance, useDisconnect, useReadContract, useSignMessage } from "wagmi";
import { formatUnits, parseAbi } from "viem";
import deployment, { DEPLOYMENT_CHAIN_ID } from "@/lib/deployment";
import {
  BookOpenText,
  CopySimple,
  Coins,
  CrosshairSimple,
  DiamondsFour,
  Gear,
  Gift,
  Lifebuoy,
  List,
  PlusMinus,
  Rows,
  SignOut,
  TrendUp,
  Trophy,
} from "@phosphor-icons/react";
import { getUserProfileByAddress, saveUserProfile } from "@/lib/supabase/profiles";
import { SidebarDrawer } from "@/app/components/sidebar-drawer";

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
  const base = address.slice(2, 6).toLowerCase();
  const suffix = Math.floor(Math.random() * 900 + 100);
  return `trader_${base}_${suffix}`;
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

/** Profile “USDC” row reads minted MondaloreUSDC (`symbol()` on-chain is still USDC). */
const PROFILE_USDC_ADDRESS = (
  deployment as unknown as { contracts?: { MondaloreUSDC?: string } }
).contracts?.MondaloreUSDC as `0x${string}` | undefined;
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [mounted, setMounted] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasRunAuthRef = useRef(false);
  const profileCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [nameModalError, setNameModalError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState("Trending");
  const [searchQuery, setSearchQuery] = useState("");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [profileName, setProfileName] = useState("");
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [isSavingProfileName, setIsSavingProfileName] = useState(false);
  const [balanceView, setBalanceView] = useState<"mon" | "usdc">("mon");
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
  const { data: nativeBalance } = useBalance({
    address,
    chainId: DEPLOYMENT_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });
  const { data: usdcBalanceRaw } = useReadContract({
    address: PROFILE_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && PROFILE_USDC_ADDRESS) },
  });
  const { data: usdcDecimalsRaw } = useReadContract({
    address: PROFILE_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: Boolean(PROFILE_USDC_ADDRESS) },
  });
  const { data: usdcSymbolRaw } = useReadContract({
    address: PROFILE_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "symbol",
    query: { enabled: Boolean(PROFILE_USDC_ADDRESS) },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !isConnected || !address) {
      hasRunAuthRef.current = false;
      return;
    }
    if (hasRunAuthRef.current) return;
    hasRunAuthRef.current = true;

    const runPostConnectFlow = async () => {
      setProfileError(null);
      setNameModalError(null);

      const alreadySigned = window.localStorage.getItem(signedSessionKey(address)) === "1";
      if (!alreadySigned) {
        try {
          const nonce = Math.floor(Math.random() * 1_000_000);
          await signMessageAsync({
            message: `Sign in to Mondalore Market\nAddress: ${address}\nNonce: ${nonce}`,
          });
          window.localStorage.setItem(signedSessionKey(address), "1");
        } catch {
          hasRunAuthRef.current = false;
          return;
        }
      }

      let existingProfile: { address: string; name: string } | null = null;
      try {
        existingProfile = await getUserProfileByAddress(address);
      } catch {
        setProfileName(createSuggestedUsername(address));
        return;
      }

      if (!existingProfile) {
        const suggested = createSuggestedUsername(address);
        setNameInput(suggested);
        setProfileName(suggested);
        setShowNameModal(true);
      } else {
        setProfileName(existingProfile.name);
      }
    };
    void runPostConnectFlow();
  }, [address, isConnected, mounted, signMessageAsync]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  const isWalletConnected = mounted && isConnected && Boolean(address);
  const availableBalanceLabel = useMemo(() => {
    if (!nativeBalance) return formatGroupedAmount(0, 4, 4);
    const value = Number(formatUnits(nativeBalance.value, nativeBalance.decimals));
    return formatGroupedAmount(value, 4, 4);
  }, [nativeBalance]);
  const profileBalance = useMemo(() => {
    if (balanceView === "usdc") {
      const bal = (usdcBalanceRaw as bigint | undefined) ?? BigInt(0);
      const decimals = Number(usdcDecimalsRaw ?? 6);
      const symbol = typeof usdcSymbolRaw === "string" ? usdcSymbolRaw : "USDC";
      const value = Number(formatUnits(bal, decimals));
      return { amount: formatGroupedAmount(value, 2, 2), symbol };
    }
    if (!nativeBalance) return { amount: formatGroupedAmount(0, 4, 4), symbol: "MON" };
    const value = Number(formatUnits(nativeBalance.value, nativeBalance.decimals));
    return {
      amount: formatGroupedAmount(value, 4, 4),
      symbol: "MON",
    };
  }, [
    balanceView,
    nativeBalance,
    usdcBalanceRaw,
    usdcDecimalsRaw,
    usdcSymbolRaw,
  ]);

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
    if (!address) {
      setWalletGraphStats(undefined);
      return;
    }
    let cancelled = false;
    setWalletGraphStats(undefined);
    void fetch(`/api/wallet/subgraph-summary?wallet=${encodeURIComponent(address)}`, { cache: "no-store" })
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
  }, [address]);
  const walletGradient = useMemo(
    () => (address ? buildWalletGradient(address) : "linear-gradient(135deg, #3f3f46, #18181b)"),
    [address],
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

  useEffect(() => {
    return () => {
      if (profileCloseTimerRef.current) clearTimeout(profileCloseTimerRef.current);
    };
  }, []);

  return (
    <main
      className={`mx-auto flex w-full flex-col py-4 pb-24 md:pb-4 ${
        viewportLocked ? "h-dvh max-h-dvh min-h-0 overflow-hidden" : "min-h-screen"
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
              ? "sticky top-0 mb-0 bg-[var(--background)]/95 py-1 backdrop-blur-md supports-[backdrop-filter]:bg-[var(--background)]/80"
              : "mb-3 md:mb-4"
          }`}
        >
          <div className="flex items-center justify-between gap-2 md:flex-nowrap md:gap-3">
            <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
              <button
                type="button"
                aria-label="Open menu"
                onClick={() => setIsSidebarOpen(true)}
                className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--foreground)] md:h-9 md:w-9"
              >
                <List size={20} weight="bold" className="md:hidden" />
                <List size={24} weight="bold" className="hidden md:block" />
              </button>
              <Link href="/" className="relative block h-12 w-12 shrink-0 md:h-20 md:w-20">
                <Image
                  src={theme === "light" ? "/light.png" : "/logo.png"}
                  alt="Mondalore Market home"
                  fill
                  className="object-contain object-center"
                  sizes="(max-width: 768px) 64px, 112px"
                  priority
                />
              </Link>
              {showSearch && (
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSearchQuery(v);
                    updateMarketQuery({ q: v.trim() ? v : null });
                  }}
                  className="hidden h-10 w-[380px] max-w-[52vw] rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] md:block"
                />
              )}
              <Link href="/how-it-works" className="hidden items-center gap-2 text-sm md:flex">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--accent)] text-xs font-semibold text-[var(--accent)]">
                  i
                </span>
                <span className="whitespace-nowrap text-[var(--accent)]">How it works</span>
              </Link>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 md:gap-3">
              {isWalletConnected ? (
                <>
                  <button
                    type="button"
                    className="group hidden rounded-xl px-2 py-1 text-right leading-tight transition hover:bg-[var(--surface-hover)] md:block"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Available
                    </p>
                    <p className="text-sm font-semibold text-[var(--foreground)] transition group-hover:text-[var(--accent)]">
                      {availableBalanceLabel} MON
                    </p>
                  </button>
                  <button type="button" className="deposit-ring relative rounded-full p-[1px]">
                    <span
                      className={`relative z-10 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold tracking-wide md:px-4 md:py-1.5 md:text-sm ${
                        theme === "light" ? "bg-transparent text-[#b5861d]" : "bg-[#090909] text-[#d8b654]"
                      }`}
                    >
                      Deposit
                    </span>
                  </button>
                  <div
                    className="relative"
                    onMouseEnter={openProfilePopover}
                    onMouseLeave={scheduleProfileClose}
                  >
                    <button
                      type="button"
                      aria-label="Open profile"
                      style={{
                        backgroundImage: walletGradient,
                        borderColor: theme === "light" ? "rgba(122, 104, 170, 0.28)" : "#d8c8ff",
                      }}
                      className="h-9 w-9 rounded-full border-2 shadow-sm md:h-10 md:w-10"
                    />
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
                              borderColor: theme === "light" ? "rgba(122, 104, 170, 0.28)" : "#d8c8ff",
                            }}
                            className="h-9 w-9 shrink-0 rounded-full border-2"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              {isEditingProfileName ? (
                                <input
                                  value={profileNameDraft}
                                  onChange={(e) => {
                                    setProfileNameDraft(e.target.value);
                                    setProfileError(null);
                                  }}
                                  className="h-7 w-[112px] border border-[var(--border)] bg-[var(--surface)] px-2 text-xs outline-none focus:border-[var(--accent)]"
                                  maxLength={40}
                                />
                              ) : (
                                <p className="truncate text-xs font-semibold text-[var(--foreground)]">
                                  {profileName || (address ? createSuggestedUsername(address) : "-")}
                                </p>
                              )}
                              <button
                                type="button"
                                disabled={isSavingProfileName}
                                onClick={async () => {
                                  if (!address) return;
                                  if (!isEditingProfileName) {
                                    setProfileNameDraft(profileName || createSuggestedUsername(address));
                                    setProfileError(null);
                                    setIsEditingProfileName(true);
                                    return;
                                  }
                                  setIsSavingProfileName(true);
                                  setProfileError(null);
                                  try {
                                    const finalName =
                                      profileNameDraft.trim() || createSuggestedUsername(address);
                                    await saveUserProfile({ address, name: finalName });
                                    setProfileName(finalName);
                                    setIsEditingProfileName(false);
                                  } catch (error) {
                                    setProfileError(
                                      error instanceof Error
                                        ? error.message
                                        : "Could not update profile name.",
                                    );
                                  } finally {
                                    setIsSavingProfileName(false);
                                  }
                                }}
                                className="border border-[var(--border)] p-1 text-[var(--muted)] hover:text-white disabled:opacity-60"
                                aria-label="Edit username"
                              >
                                {isEditingProfileName ? "Save" : <Gear size={12} />}
                              </button>
                            </div>
                            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                              <span>{address ? shortenAddress(address) : "-"}</span>
                              {address && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const origin =
                                      typeof window === "undefined"
                                        ? "https://aftrmarket.xyz"
                                        : window.location.origin;
                                    const slug = (profileName || createSuggestedUsername(address))
                                      .toLowerCase()
                                      .trim()
                                      .replace(/[^a-z0-9_-]+/g, "-");
                                    const profileUrl = `${origin}/profile/${slug}`;
                                    try {
                                      await navigator.clipboard.writeText(profileUrl);
                                    } catch {
                                      setProfileError("Could not copy profile link.");
                                    }
                                  }}
                                  className="ml-1.5 inline-flex align-middle text-[#7fd0ff] hover:text-[#a6e2ff]"
                                  aria-label="Copy profile URL"
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
                          <button
                            type="button"
                            onClick={() => setBalanceView((v) => (v === "mon" ? "usdc" : "mon"))}
                            className="mb-1 rounded-md px-1 py-0.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
                            title="Tap to switch MON / Mondalore USDC"
                          >
                            {profileBalance.amount} {profileBalance.symbol}
                          </button>
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
                                      walletGraphSummary.pnlUsd.startsWith("-") ? "text-rose-400" : "text-[#68e0a0]"
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
                            disconnect();
                            setIsProfileOpen(false);
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
                    void open();
                  }}
                  className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 md:px-4 md:py-2 md:text-sm"
                >
                  Sign in
                </button>
              )}
            </div>
          </div>

          {showSearch && (
            <div className="mt-2 flex items-center justify-start gap-3 md:hidden">
              <input
                type="search"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchQuery(v);
                  updateMarketQuery({ q: v.trim() ? v : null });
                }}
                className="h-9 w-full max-w-[240px] rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              />
            </div>
          )}
        </header>

        {showFilterStrip && (
          <>
            <div className="no-scrollbar mb-2 overflow-x-auto px-6">
              <div className="flex min-w-max items-center gap-8 whitespace-nowrap py-1">
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
                  "Breaking",
                ].map((filter) => (
                  <span
                    key={filter}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setActiveFilter(filter);
                      updateMarketQuery({ filter });
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      setActiveFilter(filter);
                      updateMarketQuery({ filter });
                    }}
                    className={`cursor-pointer text-sm font-medium transition hover:text-[var(--foreground)] ${
                      activeFilter === filter ? "text-[var(--foreground)]" : "text-[#8f86ad]"
                    }`}
                  >
                    {filter === "Trending" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <TrendUp size={16} weight="bold" />
                        {filter}
                      </span>
                    ) : (
                      filter
                    )}
                  </span>
                ))}
              </div>
            </div>
            <div className="mb-5 w-full border-t border-[var(--border)]" />
          </>
        )}

        {viewportLocked ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        ) : (
          children
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--background)]/90 px-2 py-2 backdrop-blur-md md:hidden">
        <div className="grid grid-cols-5 gap-1">
          <Link
            href="/"
            className="flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            <Rows size={18} weight="regular" />
            <span>Markets</span>
          </Link>
          <Link
            href="/create"
            className="flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            <DiamondsFour size={18} weight="regular" />
            <span>Create</span>
          </Link>
          <Link
            href="/trades"
            className="flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            <PlusMinus size={18} weight="regular" />
            <span>Trades</span>
          </Link>
          <Link
            href="/stake"
            className="flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            <Coins size={18} weight="regular" />
            <span>Stake</span>
          </Link>
          <Link
            href="/bounty-board"
            className="flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            <CrosshairSimple size={18} weight="regular" />
            <span>Bounty</span>
          </Link>
        </div>
      </nav>

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
                  if (!address) return;
                  setIsSavingName(true);
                  setNameModalError(null);
                  try {
                    const fallbackName = nameInput.trim() || createSuggestedUsername(address);
                    await saveUserProfile({ address, name: fallbackName });
                    setProfileName(fallbackName);
                    setShowNameModal(false);
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
                  if (!address) return;
                  setIsSavingName(true);
                  setNameModalError(null);
                  try {
                    const fallbackName = nameInput.trim() || createSuggestedUsername(address);
                    await saveUserProfile({ address, name: fallbackName });
                    setProfileName(fallbackName);
                    setShowNameModal(false);
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
    </main>
  );
}

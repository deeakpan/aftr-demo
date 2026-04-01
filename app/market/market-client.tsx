"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import { useAccount, useBalance, useDisconnect, useSignMessage } from "wagmi";
import { formatUnits } from "viem";
import {
  BookOpenText,
  CopySimple,
  CrownSimple,
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
import { hasWalletConnectProjectId } from "../providers";
import { getUserProfileByAddress, saveUserProfile } from "@/lib/supabase/profiles";
import { SidebarDrawer } from "@/app/components/sidebar-drawer";

function buildWalletGradient(input: string) {
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

function createSuggestedUsername(address: string) {
  const base = address.slice(2, 6).toLowerCase();
  const suffix = Math.floor(Math.random() * 900 + 100);
  return `trader_${base}_${suffix}`;
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function MarketClient() {
  const { open } = useWeb3Modal();
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
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState("Trending");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [profileName, setProfileName] = useState("");
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [isSavingProfileName, setIsSavingProfileName] = useState(false);
  const { data: nativeBalance } = useBalance({
    address,
    query: {
      enabled: Boolean(address),
    },
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
      try {
        const nonce = Math.floor(Math.random() * 1_000_000);
        await signMessageAsync({
          message: `Sign in to AFTRMarket\nAddress: ${address}\nNonce: ${nonce}`,
        });

        const existingProfile = await getUserProfileByAddress(address);
        if (!existingProfile) {
          const suggested = createSuggestedUsername(address);
          setNameInput(suggested);
          setProfileName(suggested);
          setShowNameModal(true);
        } else {
          setProfileName(existingProfile.name);
        }
      } catch (error) {
        hasRunAuthRef.current = false;
        setAuthError(error instanceof Error ? error.message : "Could not complete sign-in flow.");
      }
    };

    void runPostConnectFlow();
  }, [address, isConnected, mounted, signMessageAsync]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isK = event.key.toLowerCase() === "k";
      if ((event.ctrlKey || event.metaKey) && isK) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
    if (!nativeBalance) return "0.00";
    const value = Number(formatUnits(nativeBalance.value, nativeBalance.decimals));
    return value.toFixed(4);
  }, [nativeBalance]);
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
    <main className="mx-auto flex min-h-screen w-full py-4 pb-24 md:pb-4">
      <SidebarDrawer isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mb-6 w-full px-4 md:px-6">
          <div className="flex items-center justify-between gap-3 md:flex-nowrap">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                aria-label="Open menu"
                onClick={() => setIsSidebarOpen(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--foreground)]"
              >
                <List size={24} weight="bold" />
              </button>
              <Image src="/logo.png" alt="AFTRMarket logo" width={44} height={44} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search markets... (Ctrl/Cmd + K)"
                className="hidden h-12 w-[380px] max-w-[52vw] rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] md:block"
              />
              <div className="hidden items-center gap-2 text-sm md:flex">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--accent)] text-xs font-semibold text-[var(--accent)]">
                  i
                </span>
                <span className="whitespace-nowrap text-[var(--accent)]">How it works</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 md:gap-3">
              {isWalletConnected ? (
              <>
                <button
                  type="button"
                  className="group hidden leading-tight text-right rounded-xl px-2 py-1 transition hover:bg-[var(--surface-hover)] md:block"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                    Available
                  </p>
                  <p className="text-sm font-semibold text-[var(--foreground)] transition group-hover:text-[var(--accent)]">
                    {availableBalanceLabel} {nativeBalance?.symbol ?? "ETH"}
                  </p>
                </button>
                <button type="button" className="deposit-ring relative rounded-full p-[1px]">
                  <span
                    className={`relative z-10 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold tracking-wide ${
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
                    className="h-10 w-10 rounded-full border-2 shadow-sm"
                  />

                  {isProfileOpen && (
                    <aside
                      onMouseEnter={openProfilePopover}
                      onMouseLeave={scheduleProfileClose}
                      className="absolute right-2 top-full z-[60] mt-2 w-[220px] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-2xl"
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
                                onChange={(event) => setProfileNameDraft(event.target.value)}
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
                                  setIsEditingProfileName(true);
                                  return;
                                }
                                setIsSavingProfileName(true);
                                setAuthError(null);
                                try {
                                  const finalName =
                                    profileNameDraft.trim() || createSuggestedUsername(address);
                                  await saveUserProfile({ address, name: finalName });
                                  setProfileName(finalName);
                                  setIsEditingProfileName(false);
                                } catch (error) {
                                  setAuthError(
                                    error instanceof Error ? error.message : "Could not update profile name.",
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
                                    setAuthError("Could not copy profile link.");
                                  }
                                }}
                                className="ml-1.5 inline-flex align-middle text-[#7fd0ff] hover:text-[#a6e2ff]"
                                aria-label="Copy profile URL"
                              >
                                <CopySimple size={11} weight="bold" />
                              </button>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="my-2 border-t border-[var(--border)]" />

                      <div className="mt-2 space-y-0.5">
                        <p className="py-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">Balance</p>
                        <p className="pb-1 text-xs text-[var(--foreground)]">
                          {availableBalanceLabel} {nativeBalance?.symbol ?? "ETH"}
                        </p>
                        <p className="py-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">PnL</p>
                        <p className="pb-1 text-xs text-[#8f86ad]">-</p>
                        <p className="py-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">Win Rate</p>
                        <p className="pb-1 text-xs text-[#68e0a0]">-</p>
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
                  if (!hasWalletConnectProjectId) return;
                  open();
                }}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!hasWalletConnectProjectId}
              >
                {hasWalletConnectProjectId ? "Sign in" : "Set WalletConnect Project ID"}
              </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-start gap-3 md:hidden">
            <input
              type="text"
              placeholder="Search markets... (Ctrl/Cmd + K)"
              className="h-9 w-full max-w-[240px] rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
            />
            <div className="hidden items-center gap-2 text-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--accent)] text-xs font-semibold text-[var(--accent)]">
                i
              </span>
              <span className="whitespace-nowrap text-[var(--accent)]">How it works</span>
            </div>
          </div>
        </header>

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
                onClick={() => setActiveFilter(filter)}
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

        <section className="mx-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="mb-3 text-lg font-semibold">Markets</h2>
          <p className="text-sm text-[var(--muted)]">
            UI foundation is ready. Next step is wiring live markets from your
            contracts/factory once you are ready.
          </p>
          {!hasWalletConnectProjectId && (
            <p className="mt-3 text-sm text-red-700">
              Add `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in `.env`, then restart
              the dev server.
            </p>
          )}
        </section>

        {authError && (
          <p className="mx-6 mt-4 rounded-lg border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {authError}
          </p>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--card)]/95 px-2 py-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          {[
            { label: "Range", Icon: Rows },
            { label: "Create", Icon: DiamondsFour },
            { label: "Trades", Icon: PlusMinus },
            { label: "Leader", Icon: CrownSimple },
          ].map(({ label, Icon }) => (
            <button
              key={label}
              type="button"
              className="flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            >
              <Icon size={18} weight="regular" />
              <span>{label}</span>
            </button>
          ))}
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
              onChange={(event) => setNameInput(event.target.value)}
              className="mt-4 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm outline-none focus:border-[var(--accent)]"
              placeholder="Enter your name"
              maxLength={40}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!address) return;
                  setIsSavingName(true);
                  setAuthError(null);
                  try {
                    const fallbackName = nameInput.trim() || createSuggestedUsername(address);
                    await saveUserProfile({ address, name: fallbackName });
                    setProfileName(fallbackName);
                    setShowNameModal(false);
                  } catch (error) {
                    setAuthError(
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
                  setAuthError(null);
                  try {
                    const fallbackName = nameInput.trim() || createSuggestedUsername(address);
                    await saveUserProfile({ address, name: fallbackName });
                    setProfileName(fallbackName);
                    setShowNameModal(false);
                  } catch (error) {
                    setAuthError(
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

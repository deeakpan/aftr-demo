"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AuthLayout,
  Environment,
  ParaProviderMin,
  useAccount,
  useClient,
  useLogout,
  useModal,
  useWallet,
} from "@getpara/react-sdk-lite";
import "@getpara/react-sdk-lite/styles.css";
import { getAddress, isAddress } from "viem";
import {
  ParaSessionProvider,
  type ParaBridgeStatus,
} from "@/app/components/para-session-context";
import { isSigningOut, signOutEverywhere } from "@/lib/auth-signout";
import {
  clearParaLoginRequested,
  isParaLoginRequested,
  markParaLoginRequested,
} from "@/lib/para-login-request";
import { getParaApiKey, getParaEnvName, isParaConfigured } from "@/lib/para-config";
import { getParaWalletRecord, setParaWalletRecord } from "@/lib/para-wallet-record";
import { useSignInAttempt } from "@/lib/use-sign-in-attempt";
import { getMe, setMe, useMe } from "@/lib/useMe";

type OpenFn = () => void;
let openImpl: OpenFn | null = null;
let closeImpl: (() => void) | null = null;
let logoutImpl: (() => Promise<void>) | null = null;
/** Reset bridge retry guard when user clicks Sign in again. */
let resetBridgeImpl: (() => void) | null = null;

export function openParaModal() {
  markParaLoginRequested();
  resetBridgeImpl?.();
}

export function closeParaModal() {
  queueMicrotask(() => closeImpl?.());
}

export async function paraLogout() {
  await logoutImpl?.();
}

/** Clear app + Para session and open fresh auth (fixes stale wallet dashboard). */
export async function resetParaAuth() {
  await signOutEverywhere(() => paraLogout());
  markParaLoginRequested();
  resetBridgeImpl?.();
}

function pickEmbeddedAddress(
  account: ReturnType<typeof useAccount>,
  wallet: ReturnType<typeof useWallet>["data"],
): string | undefined {
  if (!account?.isConnected) return undefined;
  const fromWallet = wallet && typeof wallet === "object" && "address" in wallet ? wallet.address : undefined;
  const wallets = account.embedded?.wallets as unknown;
  const list = Array.isArray(wallets) ? wallets : wallets && typeof wallets === "object" ? Object.values(wallets) : [];
  const candidates = [fromWallet, ...list.map((w) => (w as { address?: string } | undefined)?.address)];
  for (const addr of candidates) {
    if (typeof addr === "string" && isAddress(addr)) return getAddress(addr);
  }
  return undefined;
}

function hasAppSession(me: `0x${string}` | undefined) {
  const record = getParaWalletRecord();
  return Boolean(me || record?.owner);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Poll until Para user id is available after OAuth. */
async function waitForParaAuth(
  client: NonNullable<ReturnType<typeof useClient>>,
  account: ReturnType<typeof useAccount>,
  timeoutMs = 12_000,
): Promise<{ paraUserId: string; email?: string }> {
  const started = Date.now();
  const originHint =
    typeof window !== "undefined"
      ? ` Add ${window.location.origin} to Allowed Origins in the Para Developer Portal.`
      : "";

  while (Date.now() - started < timeoutMs) {
    const fromClient = client.getUserId?.()?.trim();
    const fromAccount =
      account.embedded && "userId" in account.embedded
        ? (account.embedded.userId as string | undefined)?.trim()
        : undefined;
    let fromStorage: string | undefined;
    try {
      fromStorage = window.localStorage.getItem("@CAPSULE/userId")?.trim() || undefined;
    } catch {
      fromStorage = undefined;
    }
    const paraUserId = fromClient || fromAccount || fromStorage;
    if (paraUserId) {
      const email =
        client.getEmail?.()?.trim() ||
        (account.embedded && "email" in account.embedded
          ? (account.embedded.email as string | undefined)?.trim()
          : undefined);
      return { paraUserId, email };
    }
    await sleep(200);
  }
  throw new Error(`Para sign-in timed out.${originHint} Then Disconnect and sign in again.`);
}

async function waitForParaClient(
  readClient: () => ReturnType<typeof useClient>,
  timeoutMs = 15_000,
): Promise<NonNullable<ReturnType<typeof useClient>>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const c = readClient();
    if (c) return c;
    await sleep(200);
  }
  throw new Error("Para SDK did not initialize. Refresh and try again.");
}

function ParaControls() {
  const { openModal, closeModal } = useModal();
  const { logoutAsync } = useLogout();

  useEffect(() => {
    openImpl = () => {
      // Routed by ParaSignInRouter — tick via markParaLoginRequested in openParaModal.
    };
    closeImpl = () => closeModal();
    logoutImpl = () => logoutAsync();
    return () => {
      openImpl = null;
      closeImpl = null;
      logoutImpl = null;
    };
  }, [openModal, closeModal, logoutAsync]);

  return null;
}

/** Never show Para wallet dashboard when the app session is missing. */
function ParaModalGuard() {
  const me = useMe();
  const account = useAccount();
  const { closeModal } = useModal();

  useEffect(() => {
    if (hasAppSession(me)) return;
    if (account?.isConnected) closeModal();
  }, [me, account?.isConnected, closeModal]);

  return null;
}

/** On Sign in: show auth if Para is logged out; otherwise bridge silently (never wallet dashboard). */
function ParaSignInRouter() {
  const signInAttempt = useSignInAttempt();
  const me = useMe();
  const account = useAccount();
  const { data: wallet } = useWallet();
  const { openModal, closeModal } = useModal();
  const lastHandled = useRef(0);

  useEffect(() => {
    if (signInAttempt === 0 || signInAttempt === lastHandled.current) return;
    if (!isParaLoginRequested()) return;
    lastHandled.current = signInAttempt;

    if (hasAppSession(me)) {
      closeModal();
      clearParaLoginRequested();
      return;
    }

    const addr = pickEmbeddedAddress(account, wallet);
    const paraConnected = Boolean(account?.isConnected);

    // Never show Para wallet dashboard when app session is missing.
    closeModal();

    if (!paraConnected) {
      openModal();
      return;
    }

    // Connected but wallet address still hydrating — stay closed; ParaWalletBridge will run.
    if (!addr) return;
  }, [signInAttempt, me, account, wallet, openModal, closeModal]);

  return null;
}

function ParaSync({
  setParaAuthed,
  setBridgeState,
}: {
  setParaAuthed: (next: boolean) => void;
  setBridgeState: (status: ParaBridgeStatus, error?: string | null) => void;
}) {
  const me = useMe();
  const account = useAccount();
  const { data: wallet } = useWallet();

  useEffect(() => {
    const paraConnected = Boolean(account?.isConnected || account?.embedded?.isConnected);
    setParaAuthed(paraConnected);

    if (isSigningOut()) {
      if (me) setMe(undefined);
      setBridgeState("idle");
      return;
    }

    const record = getParaWalletRecord();
    if (record?.owner && me?.toLowerCase() !== record.owner.toLowerCase()) {
      setMe(record.owner);
      setBridgeState("idle");
      clearParaLoginRequested();
      return;
    }

    if (me || record?.owner) {
      setBridgeState("idle");
      clearParaLoginRequested();
      closeParaModal();
    } else if (!paraConnected) {
      setBridgeState("idle");
    } else {
      closeParaModal();
    }
  }, [account?.isConnected, account?.embedded?.isConnected, me, setBridgeState, setParaAuthed]);

  return null;
}

function ParaWalletBridge({
  setBridgeState,
}: {
  setBridgeState: (status: ParaBridgeStatus, error?: string | null) => void;
}) {
  const me = useMe();
  const signInAttempt = useSignInAttempt();
  const account = useAccount();
  const client = useClient();
  const { data: wallet } = useWallet();
  const isConnected = Boolean(account?.isConnected || account?.embedded?.isConnected);
  const embedded = pickEmbeddedAddress(account, wallet);
  const ranFor = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const clientRef = useRef(client);
  clientRef.current = client;
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;
  const accountRef = useRef(account);
  accountRef.current = account;

  useEffect(() => {
    resetBridgeImpl = () => {
      ranFor.current = null;
      inFlightRef.current = false;
    };
    return () => {
      resetBridgeImpl = null;
    };
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    if (hasAppSession(me)) return;

    const bridgeKey = signInAttempt > 0 ? `attempt:${signInAttempt}` : "passive";
    if (inFlightRef.current) return;
    if (ranFor.current === bridgeKey) return;

    let cancelled = false;
    inFlightRef.current = true;
    ranFor.current = bridgeKey;
    setBridgeState("registering");

    void (async () => {
      try {
        const readyClient = clientRef.current ?? (await waitForParaClient(() => clientRef.current));
        if (cancelled) return;

        const { paraUserId, email } = await waitForParaAuth(readyClient, accountRef.current);
        if (cancelled) return;

        const res = await fetch("/api/para/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: embeddedRef.current,
            paraUserId,
            email,
          }),
        });
        const registered = (await res.json()) as {
          owner?: string;
          walletId?: string;
          paraUserId?: string | null;
          email?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(registered.error || "Failed to register Para wallet.");
        if (cancelled) return;

        const apiOwner = registered.owner?.toLowerCase();
        if (apiOwner && isAddress(apiOwner) && registered.walletId) {
          const checksum = getAddress(apiOwner) as `0x${string}`;
          setMe(checksum);
          setParaWalletRecord({
            owner: checksum,
            walletId: registered.walletId,
            paraUserId: registered.paraUserId ?? paraUserId,
            email: registered.email ?? email ?? null,
            updatedAt: Date.now(),
          });
          setBridgeState("idle");
          clearParaLoginRequested();
          closeParaModal();
        } else {
          throw new Error("Para register returned an invalid wallet.");
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("Para wallet bridge failed:", msg);
        ranFor.current = null;
        setBridgeState("failed", msg);
      } finally {
        inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      inFlightRef.current = false;
      if (!hasAppSession(me)) ranFor.current = null;
    };
  }, [isConnected, me, signInAttempt, setBridgeState]);

  return null;
}

function ParaWalletProviderInner({ children }: { children: ReactNode }) {
  const [paraAuthed, setParaAuthed] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<ParaBridgeStatus>("idle");
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const setBridgeState = useCallback((status: ParaBridgeStatus, error: string | null = null) => {
    setBridgeStatus((prev) => {
      if (prev === status) return prev;
      return status;
    });
    setBridgeError((prev) => {
      if (prev === error) return prev;
      return error;
    });
  }, []);

  const sessionValue = useMemo(
    () => ({
      paraAuthed,
      bridgeStatus,
      bridgeError,
      setParaAuthed,
      setBridgeState,
    }),
    [paraAuthed, bridgeStatus, bridgeError, setBridgeState],
  );

  const paraCallbacks = useMemo(
    () => ({
      onLogin: (event: { detail?: { data?: { isComplete?: boolean; isError?: boolean } } }) => {
        const data = event.detail?.data;
        if (!data?.isComplete || data?.isError || hasAppSession(getMe())) return;
        markParaLoginRequested();
        resetBridgeImpl?.();
      },
      onAccountSetup: () => {
        if (hasAppSession(getMe())) return;
        markParaLoginRequested();
        resetBridgeImpl?.();
      },
    }),
    [],
  );

  const env = getParaEnvName() === "PROD" ? Environment.PROD : Environment.BETA;
  const logo = `${typeof window !== "undefined" ? window.location.origin : ""}/logo.png`;
  const configOverrides = {
    themeConfig: {
      mode: "dark" as const,
      backgroundColor: "#000000",
      foregroundColor: "#3b82f6",
      borderRadius: "md" as const,
      foregroundMixRatio: 0.08,
    },
    authConfig: {
      oAuthMethods: ["GOOGLE", "TWITTER"],
      disableEmailLogin: false,
      disablePhoneLogin: true,
      isGuestModeEnabled: false,
      twoFactorAuthEnabled: false,
    },
    modalConfig: {
      disableAddFundsPrompt: true,
      authLayout: [AuthLayout.AUTH_FULL],
      hideWallets: true,
      logo,
    },
    externalWalletConfig: {
      wallets: [] as string[],
    },
  };

  return (
    <ParaSessionProvider value={sessionValue}>
      <ParaProviderMin
        paraClientConfig={{ env, apiKey: getParaApiKey(), opts: { configOverrides } }}
        config={{ appName: "Zedkr Market" }}
        callbacks={paraCallbacks}
        configOverrides={configOverrides}
        paraModalConfig={{
          recoverySecretStepEnabled: false,
        }}
      >
        {children}
        <ParaControls />
        <ParaModalGuard />
        <ParaSignInRouter />
        <ParaSync setParaAuthed={setParaAuthed} setBridgeState={setBridgeState} />
        <ParaWalletBridge setBridgeState={setBridgeState} />
      </ParaProviderMin>
    </ParaSessionProvider>
  );
}

export function ParaWalletProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !isParaConfigured()) return <>{children}</>;

  return <ParaWalletProviderInner>{children}</ParaWalletProviderInner>;
}

export { getMe } from "@/lib/useMe";

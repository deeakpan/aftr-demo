"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { setMe, useMe } from "@/lib/useMe";

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
  closeImpl?.();
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
    const addr = pickEmbeddedAddress(account, wallet);
    const paraConnected = Boolean(account?.isConnected && addr);
    setParaAuthed(paraConnected);

    if (isSigningOut()) {
      if (me) setMe(undefined);
      setBridgeState("idle");
      return;
    }

    const record = getParaWalletRecord();
    if (record?.owner && (!me || me.toLowerCase() !== record.owner.toLowerCase())) {
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
      // Para cookie restored without app session — bridge in background, keep modal closed.
      closeParaModal();
    }
  }, [account, wallet, me, setParaAuthed, setBridgeState]);

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
  const ranFor = useRef<string | null>(null);
  const isConnected = Boolean(account?.isConnected);
  const embedded = pickEmbeddedAddress(account, wallet);

  useEffect(() => {
    resetBridgeImpl = () => {
      ranFor.current = null;
    };
    return () => {
      resetBridgeImpl = null;
    };
  }, []);

  useEffect(() => {
    if (!isConnected || !client || !embedded) return;
    if (me && me.toLowerCase() !== embedded.toLowerCase()) {
      setBridgeState("idle");
      clearParaLoginRequested();
      return;
    }
    const key = embedded.toLowerCase();
    if (ranFor.current === key) return;

    let cancelled = false;
    ranFor.current = key;
    if (isParaLoginRequested() || !hasAppSession(me)) {
      setBridgeState("registering");
    }

    void (async () => {
      const maxAttempts = 3;
      const bridgeTimeoutMs = 45_000;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const session = await Promise.race([
            (client.waitAndExportSession ?? client.exportSession)?.call(client, {
              excludeSigners: false,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Para session export timed out")), bridgeTimeoutMs),
            ),
          ]);
          if (cancelled) return;
          const sessionCookie = client.retrieveSessionCookie?.() ?? null;
          const paraUserId = client.getUserId?.()?.trim();
          const email = client.getEmail?.()?.trim();

          const res = await fetch("/api/para/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              owner: embedded,
              paraUserId,
              session,
              sessionCookie,
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
              paraUserId: registered.paraUserId,
              email: registered.email,
              updatedAt: Date.now(),
            });
            setBridgeState("idle");
            clearParaLoginRequested();
            closeParaModal();
          } else {
            throw new Error("Para register returned an invalid wallet.");
          }
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const transient =
            /timeout|timed out|AxiosError|ParaApiError|network|fetch failed|aborted|ETIMEDOUT|EAI_AGAIN/i.test(
              msg,
            );
          console.warn(
            `Para wallet bridge attempt ${attempt}/${maxAttempts} failed:`,
            transient ? "wallet service timeout/unreachable" : msg,
          );
          if (!transient || attempt === maxAttempts) {
            if (!cancelled) {
              ranFor.current = null;
              setBridgeState("failed", msg);
              clearParaLoginRequested();
            }
            return;
          }
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, embedded, client, me, signInAttempt, setBridgeState]);

  return null;
}

function ParaWalletProviderInner({ children }: { children: ReactNode }) {
  const [paraAuthed, setParaAuthed] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<ParaBridgeStatus>("idle");
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const setBridgeState = (status: ParaBridgeStatus, error: string | null = null) => {
    setBridgeStatus(status);
    setBridgeError(error);
  };

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
    <ParaSessionProvider
      value={{
        paraAuthed,
        bridgeStatus,
        bridgeError,
        setParaAuthed,
        setBridgeState,
      }}
    >
      <ParaProviderMin
        paraClientConfig={{ env, apiKey: getParaApiKey(), opts: { configOverrides } }}
        config={{ appName: "Zedkr Market" }}
        waitForReady={false}
        configOverrides={configOverrides}
        paraModalConfig={{
          recoverySecretStepEnabled: false,
          hideWallets: true,
          authLayout: [AuthLayout.AUTH_FULL],
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

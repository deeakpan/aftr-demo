"use client";

import { useEffect, type ReactNode } from "react";
import {
  Environment,
  ParaProviderMin,
  useClient,
  useLogout,
  useModal,
} from "@getpara/react-sdk-lite";
import "@getpara/react-sdk-lite/styles.css";
import { getParaApiKey, isParaConfigured } from "@/lib/para-config";

const paraApiKey = getParaApiKey();

function paraClientEnv(apiKey: string) {
  return apiKey.toLowerCase().startsWith("beta_") ? Environment.BETA : Environment.PROD;
}

const paraClientConfig = {
  env: paraClientEnv(paraApiKey),
  apiKey: paraApiKey,
};

const paraAppConfig = { appName: "Zedkr Market" };

/**
 * Solana/Cosmos stubs only. Do not pass evmConnector — Para's EVM wrapper
 * rebuilds a wagmi `config` object every render and setStates forever.
 */
const paraExternalWalletConfig = {
  cosmosConnector: {
    config: {
      chains: [
        {
          chainId: "theta-testnet-001",
          currencies: [{ coinDenom: "atom", coinMinimalDenom: "uatom", coinDecimals: 6 }],
          rest: "https://cosmoshubt.lava.build",
          rpc: "https://cosmoshubt.tendermintrpc.lava.build:443",
          bech32Config: {
            bech32PrefixAccAddr: "cosmos",
            bech32PrefixAccPub: "cosmospub",
            bech32PrefixValAddr: "cosmosvaloper",
            bech32PrefixValPub: "cosmosvaloperpub",
            bech32PrefixConsAddr: "cosmosvalcons",
            bech32PrefixConsPub: "cosmosvalconspub",
          },
          chainName: "cosmoshubtestnet",
          feeCurrencies: [
            {
              coinDenom: "atom",
              coinMinimalDenom: "uatom",
              coinDecimals: 6,
              coinGeckoId: "",
              gasPriceStep: { low: 0.01, average: 0.025, high: 0.03 },
            },
          ],
          stakeCurrency: { coinDenom: "atom", coinMinimalDenom: "uatom", coinDecimals: 6 },
          bip44: { coinType: 118 },
        },
      ],
      onSwitchChain: () => {},
      selectedChainId: "theta-testnet-001",
    },
  },
  solanaConnector: {
    config: {
      chain: "devnet" as const,
      endpoint: "https://api.devnet.solana.com",
      appIdentity: {
        name: "Zedkr Market",
        uri: "https://zedkr.market",
        icon: "/para-logo.png",
      },
    },
  },
};

const paraModalConfig = {
  recoverySecretStepEnabled: true,
  onRampTestMode: true,
  oAuthMethods: ["GOOGLE", "TWITTER", "APPLE"] as Array<"GOOGLE" | "TWITTER" | "APPLE">,
  disableEmailLogin: false,
  disablePhoneLogin: false,
  isGuestModeEnabled: false,
  twoFactorAuthEnabled: false,
  authLayout: ["AUTH:FULL"] as Array<"AUTH:FULL">,
  hideWallets: false,
  disableAddFundsPrompt: false,
  logo: "/para-logo.png",
  theme: {
    mode: "dark" as const,
    backgroundColor: "#000000",
    foregroundColor: "#3b82f6",
    borderRadius: "md" as const,
    foregroundMixRatio: 0.08,
  },
};

type OpenFn = () => void;
let openImpl: OpenFn | null = null;
let logoutImpl: (() => Promise<void>) | null = null;
let exportSessionImpl: (() => Promise<string>) | null = null;

export function openParaModal() {
  openImpl?.();
}

export async function paraLogout() {
  await logoutImpl?.();
}

export async function exportParaSession(): Promise<string> {
  if (!exportSessionImpl) throw new Error("Connect wallet first.");
  return exportSessionImpl();
}

function ParaControls() {
  const { openModal } = useModal();
  const { logoutAsync } = useLogout();
  const client = useClient();

  useEffect(() => {
    openImpl = () => openModal();
    logoutImpl = () => logoutAsync();
    exportSessionImpl = async () => {
      if (!client) throw new Error("Para is still connecting. Try again in a moment.");
      return client.waitAndExportSession();
    };
    try {
      window.localStorage.removeItem("zedkr-para-me");
      window.localStorage.removeItem("zedkr-para-wallet");
    } catch {
      // ignore
    }
    return () => {
      openImpl = null;
      logoutImpl = null;
      exportSessionImpl = null;
    };
  }, [openModal, logoutAsync, client]);

  return null;
}

/**
 * ParaProvider (full) rebuilds `externalWalletConfig` every render, which makes
 * 3.16's wallet-sync effects setState forever. Min + a module-level config
 * is the same connectors without that loop. Theme/auth go on paraModalConfig
 * so we never call setSdkConfigOverrides on each render.
 */
export function ParaWalletProvider({ children }: { children: ReactNode }) {
  if (!isParaConfigured()) {
    if (process.env.NODE_ENV === "development") {
      console.warn("NEXT_PUBLIC_PARA_API_KEY is missing — wallet sign-in will not work until it is set.");
    }
    return <>{children}</>;
  }

  return (
    <ParaProviderMin
      waitForReady={false}
      paraClientConfig={paraClientConfig}
      config={paraAppConfig}
      externalWalletConfig={paraExternalWalletConfig}
      paraModalConfig={paraModalConfig}
    >
      {children}
      <ParaControls />
    </ParaProviderMin>
  );
}

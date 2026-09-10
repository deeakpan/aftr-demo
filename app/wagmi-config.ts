/** WalletConnect is optional. Para sign-in does not use this. */
export const envProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
export const hasWalletConnectProjectId = envProjectId.length > 0;
export const walletConnectProjectId = envProjectId;

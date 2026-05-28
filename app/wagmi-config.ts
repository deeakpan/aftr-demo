/** WalletConnect flags safe to import from server or client bundles. */
export const envProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
export const hasWalletConnectProjectId = envProjectId.length > 0;
export const walletConnectProjectId = hasWalletConnectProjectId ? envProjectId : "demo-project-id";

/** Nad.fun REST API — mainnet default for Nad token markets. */
export function nadApiBaseUrl(): string {
  return (
    process.env.NAD_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_NAD_API_BASE_URL?.trim() ||
    "https://api.nad.fun"
  ).replace(/\/$/, "");
}

/** Infrastructure contracts — not Nad.fun meme token CAs. */
const NAD_INFRA_LABELS: Record<string, string> = {
  "0x5a4e0bfdef88c9032cb4d24338c5eb3d3870bfdd": "WMON (quote token)",
  "0x75588668999ca0557b78046b8a5e86b47b9234ec": "Nad router",
  "0x27063a38ec0d3281d354090eb92e669ed1eb956c": "Bonding curve",
  "0x59c51c66b79c68f63d5446940cd13b6968788e36": "DEX factory",
  "0xbe3fa50514d9617ce645a02b34f595541af02b6b": "LVMON (quote token)",
};

export function knownNadInfraLabel(address: string): string | null {
  return NAD_INFRA_LABELS[address.toLowerCase()] ?? null;
}

/** Nad.fun web app — pairs with API base (mainnet vs testnet). */
export function nadAppBaseUrl(): string {
  const api = nadApiBaseUrl();
  if (api.includes("testnet")) return "https://testnet.nad.fun";
  return "https://nad.fun";
}

export function nadTokenPageUrl(tokenAddress: string): string {
  return `${nadAppBaseUrl()}/tokens/${tokenAddress.toLowerCase()}`;
}

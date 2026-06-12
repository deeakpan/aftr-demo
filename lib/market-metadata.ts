/** Whether on-chain metadata URI points at IPFS or HTTP(S). */
export function isValidMetadataUri(uri: string): boolean {
  const t = uri.trim();
  if (!t) return false;
  if (t.startsWith("ipfs://")) {
    return t.slice(7).trim().length >= 4;
  }
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Whether metadata JSON includes a usable cover image reference. */
export function isValidMarketImageRef(imageRef: string | undefined | null): boolean {
  const img = (imageRef ?? "").trim();
  if (!img) return false;
  if (img.startsWith("ipfs://")) return img.length > 7;
  try {
    const u = new URL(img);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isListableMarket(metadataUri: string, imageRef: string | undefined | null): boolean {
  return isValidMetadataUri(metadataUri) && isValidMarketImageRef(imageRef);
}

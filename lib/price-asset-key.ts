import { keccak256, stringToBytes } from "viem";

/** Matches factory `keccak256(abi.encodePacked(symbol))` — use uppercase asset tickers. */
export function priceAssetKey(symbol: string): `0x${string}` {
  return keccak256(stringToBytes(symbol.trim().toUpperCase()));
}

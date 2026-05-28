import { Address, BigInt } from "@graphprotocol/graph-ts";

export function addrId(a: Address): string {
  return a.toHexString().toLowerCase();
}

export function positionId(market: Address, trader: Address): string {
  return addrId(market).concat("-").concat(addrId(trader));
}

export function tradeId(txHash: string, logIndex: i32): string {
  return txHash.concat("-").concat(logIndex.toString());
}

export const ZERO = BigInt.fromI32(0);

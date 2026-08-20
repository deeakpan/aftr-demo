import { parseAbi, type Abi, type Address, type PublicClient } from "viem";

/** Shared on-chain reads for parimutuel + FPMM markets. */
export const MARKET_READ_ABI = parseAbi([
  "function marketKind() view returns (uint8)",
  "function metadataURI() view returns (string)",
  "function stakeEndTimestamp() view returns (uint256)",
  "function resolveAfterTimestamp() view returns (uint256)",
  "function numOutcomes() view returns (uint8)",
  "function state() view returns (uint8)",
  "function collateralDecimals() view returns (uint8)",
  "function collateralAddress() view returns (address)",
  "function realPool(uint256 outcomeIndex) view returns (uint256)",
  "function poolBalances(uint256 outcomeIndex) view returns (uint256)",
  "function priceOf(uint8 outcomeIndex) view returns (uint256)",
  "function priceBinLower(uint256) view returns (uint256)",
  "function priceBinUpper(uint256) view returns (uint256)",
  "function chainlinkFeed() view returns (address)",
  "function priceThreshold() view returns (uint256)",
  "function priceThresholdKind() view returns (uint8)",
  "function priceUpperBound() view returns (uint256)",
  "function winningOutcomeIndex() view returns (uint256)",
  "function settledOraclePrice() view returns (int256)",
  "function settlementTimestamp() view returns (uint256)",
  "function redemptionRate() view returns (uint256)",
  "function outcomeToken(uint256) view returns (address)",
  "function redeem(uint8 outcomeIndex, uint256 shareAmount)",
]);

export const PARIMUTUEL_TRADE_ABI = parseAbi([
  "function deposit(uint8 outcomeIndex, uint256 amount, address recipient, uint256 minSharesOut) payable",
]);

export const FPMM_TRADE_ABI = parseAbi([
  "function buy(uint8 outcomeIndex, uint256 investmentAmount, uint256 minOutcomeTokens)",
  "function sell(uint8 outcomeIndex, uint256 returnAmount, uint256 maxOutcomeTokens)",
]);

export const PARIMUTUEL_MARKET_ABI = [...MARKET_READ_ABI, ...PARIMUTUEL_TRADE_ABI] as Abi;
export const FPMM_MARKET_ABI = [...MARKET_READ_ABI, ...FPMM_TRADE_ABI] as Abi;

export function marketTradeAbi(isFpmm: boolean): Abi {
  return isFpmm ? FPMM_MARKET_ABI : PARIMUTUEL_MARKET_ABI;
}

export function marketPoolFunction(isFpmm: boolean): "poolBalances" | "realPool" {
  return isFpmm ? "poolBalances" : "realPool";
}

export type MarketBuyParams = {
  outcomeIndex: number;
  amountUnits: bigint;
  recipient: `0x${string}`;
  minSharesOut: bigint;
};

export function marketBuyCall(isFpmm: boolean, p: MarketBuyParams) {
  if (isFpmm) {
    return {
      abi: FPMM_MARKET_ABI,
      functionName: "buy" as const,
      args: [p.outcomeIndex, p.amountUnits, p.minSharesOut] as const,
    };
  }
  return {
    abi: PARIMUTUEL_MARKET_ABI,
    functionName: "deposit" as const,
    args: [p.outcomeIndex, p.amountUnits, p.recipient, p.minSharesOut] as const,
  };
}

export type MarketSellParams = {
  outcomeIndex: number;
  returnAmount: bigint;
  maxOutcomeTokens: bigint;
};

export function marketSellCall(p: MarketSellParams) {
  return {
    abi: FPMM_MARKET_ABI,
    functionName: "sell" as const,
    args: [p.outcomeIndex, p.returnAmount, p.maxOutcomeTokens] as const,
  };
}

export function tradeKindLabel(kind: string): string {
  if (kind === "buy" || kind === "deposit") return "Buy";
  if (kind === "sell") return "Sell";
  if (kind === "redeem") return "Redeem";
  return kind;
}

export function isBuyTradeKind(kind: string): boolean {
  return kind === "buy" || kind === "deposit";
}

export async function readMarketPoolTotal(
  client: PublicClient,
  market: Address,
  outcomeCount: number,
  isFpmm: boolean,
): Promise<bigint> {
  const fn = marketPoolFunction(isFpmm);
  const pools = await Promise.all(
    Array.from({ length: outcomeCount }, (_, i) =>
      client.readContract({
        address: market,
        abi: MARKET_READ_ABI,
        functionName: fn,
        args: [BigInt(i)],
      }) as Promise<bigint>,
    ),
  );
  return pools.reduce((acc, v) => acc + v, BigInt(0));
}

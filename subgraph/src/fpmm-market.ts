import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  FpmmBuy,
  FpmmSell,
  TokensRedeemed,
  MarketInitialized,
  MarketSettled,
  PonsTokenResolved,
  EventResolved,
} from "../generated/templates/FpmmMarket/FpmmMarket";
import { Market, MarketTrade } from "../generated/schema";
import {
  creditRedemption,
  loadOrCreatePosition,
  loadOrCreateTrader,
} from "./trade-helpers";
import { addrId, tradeId } from "./ids";

const MARKET_STATE_SETTLED = 2;

function markMarketSettled(marketAddr: Address, timestamp: BigInt): void {
  const marketId = addrId(marketAddr);
  const m = Market.load(marketId);
  if (m == null) return;
  m.state = MARKET_STATE_SETTLED;
  m.settledAt = timestamp;
  m.save();
}

function saveTrade(
  marketId: string,
  traderAddr: Address,
  outcomeIndex: i32,
  amount: BigInt,
  kind: string,
  timestamp: BigInt,
  blockNumber: BigInt,
  txHash: string,
  logIndex: i32,
): void {
  const trade = new MarketTrade(tradeId(txHash, logIndex));
  trade.market = marketId;
  trade.trader = addrId(traderAddr);
  trade.timestamp = timestamp;
  trade.blockNumber = blockNumber;
  trade.collateralAmount = amount;
  trade.outcomeIndex = outcomeIndex;
  trade.kind = kind;
  trade.save();
}

export function handleFpmmBuy(event: FpmmBuy): void {
  const marketAddr = event.address;
  const buyer = event.params.buyer;
  const amount = event.params.investmentAmount;
  const shares = event.params.outcomeTokensBought;
  const timestamp = event.block.timestamp;

  const marketId = addrId(marketAddr);
  if (Market.load(marketId) == null) {
    return;
  }

  const trader = loadOrCreateTrader(buyer);
  trader.totalDeposited = trader.totalDeposited.plus(amount);
  trader.save();

  const pos = loadOrCreatePosition(marketAddr, buyer);
  pos.collateralIn = pos.collateralIn.plus(amount);
  pos.sharesIn = pos.sharesIn.plus(shares);
  pos.lastTradeTimestamp = timestamp;
  pos.save();

  saveTrade(
    marketId,
    buyer,
    event.params.outcomeIndex,
    amount,
    "buy",
    timestamp,
    event.block.number,
    event.transaction.hash.toHexString(),
    event.logIndex.toI32(),
  );
}

export function handleFpmmSell(event: FpmmSell): void {
  const marketAddr = event.address;
  const seller = event.params.seller;
  const amount = event.params.returnAmount;
  const shares = event.params.outcomeTokensSold;
  const timestamp = event.block.timestamp;

  const marketId = addrId(marketAddr);
  if (Market.load(marketId) == null) {
    return;
  }

  const pos = loadOrCreatePosition(marketAddr, seller);
  pos.collateralOut = pos.collateralOut.plus(amount);
  pos.sharesOut = pos.sharesOut.plus(shares);
  pos.lastTradeTimestamp = timestamp;
  pos.save();

  saveTrade(
    marketId,
    seller,
    event.params.outcomeIndex,
    amount,
    "sell",
    timestamp,
    event.block.number,
    event.transaction.hash.toHexString(),
    event.logIndex.toI32(),
  );
}

export function handleTokensRedeemed(event: TokensRedeemed): void {
  creditRedemption(
    event.address,
    event.params.user,
    event.params.outcomeIndex,
    event.params.payout,
    event.params.shares,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash.toHexString(),
    event.logIndex.toI32(),
  );
}

export function handleMarketInitialized(event: MarketInitialized): void {
  const marketId = addrId(event.address);
  const m = Market.load(marketId);
  if (m == null) return;
  m.metadataURI = event.params.metadataURI;
  m.save();
}

export function handleMarketSettled(event: MarketSettled): void {
  markMarketSettled(event.address, event.block.timestamp);
}

export function handlePonsTokenResolved(event: PonsTokenResolved): void {
  markMarketSettled(event.address, event.block.timestamp);
}

export function handleEventResolved(event: EventResolved): void {
  markMarketSettled(event.address, event.block.timestamp);
}

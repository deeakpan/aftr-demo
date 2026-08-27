import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Market, MarketTrade, Trader, TraderMarketPosition } from "../generated/schema";
import { ZERO, addrId, positionId, tradeId } from "./ids";

export function loadOrCreateTrader(addr: Address): Trader {
  const id = addrId(addr);
  let t = Trader.load(id);
  if (t == null) {
    t = new Trader(id);
    t.totalDeposited = ZERO;
    t.totalRedeemed = ZERO;
    t.save();
  }
  return t as Trader;
}

export function loadOrCreatePosition(marketAddr: Address, traderAddr: Address): TraderMarketPosition {
  const id = positionId(marketAddr, traderAddr);
  let p = TraderMarketPosition.load(id);
  if (p == null) {
    p = new TraderMarketPosition(id);
    p.market = addrId(marketAddr);
    p.trader = addrId(traderAddr);
    p.collateralIn = ZERO;
    p.collateralOut = ZERO;
    p.sharesIn = ZERO;
    p.sharesOut = ZERO;
    p.lastTradeTimestamp = ZERO;
    p.save();
  }
  return p as TraderMarketPosition;
}

export function creditRedemption(
  marketAddr: Address,
  userAddr: Address,
  outcomeIndex: i32,
  payout: BigInt,
  shares: BigInt,
  timestamp: BigInt,
  blockNumber: BigInt,
  txHash: string,
  logIndex: i32,
): void {
  const marketId = addrId(marketAddr);
  if (Market.load(marketId) == null) {
    return;
  }

  const trader = loadOrCreateTrader(userAddr);
  trader.totalRedeemed = trader.totalRedeemed.plus(payout);
  trader.save();

  const pos = loadOrCreatePosition(marketAddr, userAddr);
  pos.collateralOut = pos.collateralOut.plus(payout);
  pos.sharesOut = pos.sharesOut.plus(shares);
  pos.lastTradeTimestamp = timestamp;
  pos.save();

  const trade = new MarketTrade(tradeId(txHash, logIndex));
  trade.market = marketId;
  trade.trader = addrId(userAddr);
  trade.timestamp = timestamp;
  trade.blockNumber = blockNumber;
  trade.collateralAmount = payout;
  trade.outcomeIndex = outcomeIndex;
  trade.kind = "redeem";
  trade.save();
}

import { Address } from "@graphprotocol/graph-ts";
import {
  RouterDeposited,
  RouterRedeemed,
  RouterRedeemedAndRepaid,
} from "../generated/Router/Router";
import { Market, Trader, TraderMarketPosition } from "../generated/schema";
import { ZERO, addrId, positionId } from "./ids";

function loadOrCreateTrader(addr: Address): Trader {
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

function loadOrCreatePosition(
  marketAddr: Address,
  traderAddr: Address,
): TraderMarketPosition {
  const id = positionId(marketAddr, traderAddr);
  let p = TraderMarketPosition.load(id);
  if (p == null) {
    const marketId = addrId(marketAddr);
    const traderId = addrId(traderAddr);
    p = new TraderMarketPosition(id);
    p.market = marketId;
    p.trader = traderId;
    p.collateralIn = ZERO;
    p.collateralOut = ZERO;
    p.sharesIn = ZERO;
    p.sharesOut = ZERO;
    p.lastTradeTimestamp = ZERO;
    p.save();
  }
  return p as TraderMarketPosition;
}

export function handleRouterDeposited(event: RouterDeposited): void {
  const marketAddr = event.params.market;
  const user = event.params.user;
  const amount = event.params.amount;

  const marketId = addrId(marketAddr);
  if (Market.load(marketId) == null) return;

  const trader = loadOrCreateTrader(user);
  trader.totalDeposited = trader.totalDeposited.plus(amount);
  trader.save();

  const pos = loadOrCreatePosition(marketAddr, user);
  pos.collateralIn = pos.collateralIn.plus(amount);
  pos.lastTradeTimestamp = event.block.timestamp;
  pos.save();
}

export function handleRouterRedeemed(event: RouterRedeemed): void {
  const marketAddr = event.params.market;
  const user = event.params.user;
  const payout = event.params.payoutAmount;
  const shares = event.params.shareAmount;

  const marketId = addrId(marketAddr);
  if (Market.load(marketId) == null) return;

  const trader = loadOrCreateTrader(user);
  trader.totalRedeemed = trader.totalRedeemed.plus(payout);
  trader.save();

  const pos = loadOrCreatePosition(marketAddr, user);
  pos.collateralOut = pos.collateralOut.plus(payout);
  pos.sharesOut = pos.sharesOut.plus(shares);
  pos.lastTradeTimestamp = event.block.timestamp;
  pos.save();
}

export function handleRouterRedeemedAndRepaid(
  event: RouterRedeemedAndRepaid,
): void {
  // Treat this as a redeem event for user stats.
  const marketAddr = event.params.market;
  const user = event.params.user;
  const payout = event.params.payoutAmount;
  const shares = event.params.shareAmount;

  const marketId = addrId(marketAddr);
  if (Market.load(marketId) == null) return;

  const trader = loadOrCreateTrader(user);
  trader.totalRedeemed = trader.totalRedeemed.plus(payout);
  trader.save();

  const pos = loadOrCreatePosition(marketAddr, user);
  pos.collateralOut = pos.collateralOut.plus(payout);
  pos.sharesOut = pos.sharesOut.plus(shares);
  pos.lastTradeTimestamp = event.block.timestamp;
  pos.save();
}

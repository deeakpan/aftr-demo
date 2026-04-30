import { Address } from "@graphprotocol/graph-ts";
import { Deposited, TokensRedeemed } from "../generated/templates/Market/Market";
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

function loadOrCreatePosition(marketAddr: Address, traderAddr: Address): TraderMarketPosition {
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
    p.save();
  }
  return p as TraderMarketPosition;
}

export function handleDeposited(event: Deposited): void {
  const marketAddr = event.address;
  const recipient = event.params.recipient;
  const amount = event.params.collateralAmount;
  const shares = event.params.sharesMinted;

  const marketId = addrId(marketAddr);
  if (Market.load(marketId) == null) {
    return;
  }

  const trader = loadOrCreateTrader(recipient);
  trader.totalDeposited = trader.totalDeposited.plus(amount);
  trader.save();

  const pos = loadOrCreatePosition(marketAddr, recipient);
  pos.collateralIn = pos.collateralIn.plus(amount);
  pos.sharesIn = pos.sharesIn.plus(shares);
  pos.save();
}

export function handleTokensRedeemed(event: TokensRedeemed): void {
  const marketAddr = event.address;
  const user = event.params.user;
  const payout = event.params.payout;
  const shares = event.params.shares;

  const marketId = addrId(marketAddr);
  if (Market.load(marketId) == null) {
    return;
  }

  const trader = loadOrCreateTrader(user);
  trader.totalRedeemed = trader.totalRedeemed.plus(payout);
  trader.save();

  const pos = loadOrCreatePosition(marketAddr, user);
  pos.collateralOut = pos.collateralOut.plus(payout);
  pos.sharesOut = pos.sharesOut.plus(shares);
  pos.save();
}

import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Deposited, TokensRedeemed } from "../generated/templates/Market/Market";
import { Market, MarketTrade, Trader, TraderMarketPosition } from "../generated/schema";
import { ZERO, addrId, positionId, tradeId } from "./ids";

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
    p.lastTradeTimestamp = ZERO;
    p.save();
  }
  return p as TraderMarketPosition;
}

function saveDepositTrade(
  marketId: string,
  traderAddr: Address,
  outcomeIndex: i32,
  amount: BigInt,
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
  trade.kind = "deposit";
  trade.save();
}

function saveRedeemTrade(
  marketId: string,
  traderAddr: Address,
  outcomeIndex: i32,
  payout: BigInt,
  blockNumber: BigInt,
  txHash: string,
  logIndex: i32,
  timestamp: BigInt,
): void {
  const trade = new MarketTrade(tradeId(txHash, logIndex));
  trade.market = marketId;
  trade.trader = addrId(traderAddr);
  trade.timestamp = timestamp;
  trade.blockNumber = blockNumber;
  trade.collateralAmount = payout;
  trade.outcomeIndex = outcomeIndex;
  trade.kind = "redeem";
  trade.save();
}

export function handleDeposited(event: Deposited): void {
  const marketAddr = event.address;
  const recipient = event.params.recipient;
  const amount = event.params.collateralAmount;
  const shares = event.params.sharesMinted;
  const timestamp = event.params.timestamp;

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
  pos.lastTradeTimestamp = timestamp;
  pos.save();

  saveDepositTrade(
    marketId,
    recipient,
    event.params.outcomeIndex,
    amount,
    timestamp,
    event.block.number,
    event.transaction.hash.toHexString(),
    event.logIndex.toI32(),
  );
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

  saveRedeemTrade(
    marketId,
    userAddr,
    outcomeIndex,
    payout,
    blockNumber,
    txHash,
    logIndex,
    timestamp,
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

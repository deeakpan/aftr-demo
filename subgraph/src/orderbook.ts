import { Bytes } from "@graphprotocol/graph-ts";
import {
  OrderPlaced,
  OrderMatched,
  OrderCancelled,
} from "../generated/OrderBook/OrderBook";
import { LimitOrder, LimitOrderFill, Market } from "../generated/schema";
import { ZERO, addrId, tradeId } from "./ids";

function orderIdHex(orderId: Bytes): string {
  return orderId.toHexString().toLowerCase();
}

export function handleOrderPlaced(event: OrderPlaced): void {
  const id = orderIdHex(event.params.orderId);
  const marketAddr = addrId(event.params.market);

  const order = new LimitOrder(id);
  if (Market.load(marketAddr) != null) {
    order.market = marketAddr;
  }
  order.marketAddress = marketAddr;
  order.token = addrId(event.params.token);
  order.user = addrId(event.params.user);
  order.price = event.params.price;
  order.amount = event.params.amount;
  order.isBuy = event.params.isBuy;
  order.status = "open";
  order.createdAt = event.block.timestamp;
  order.createdAtBlock = event.block.number;
  order.txHash = event.transaction.hash.toHexString();
  order.save();
}

export function handleOrderMatched(event: OrderMatched): void {
  const marketAddr = addrId(event.params.market);
  const fill = new LimitOrderFill(
    tradeId(event.transaction.hash.toHexString(), event.logIndex.toI32()),
  );
  if (Market.load(marketAddr) != null) {
    fill.market = marketAddr;
  }
  fill.marketAddress = marketAddr;
  fill.token = addrId(event.params.token);
  fill.maker = addrId(event.params.maker);
  fill.taker = addrId(event.params.taker);
  fill.price = event.params.price;
  fill.amount = event.params.amount;
  fill.timestamp = event.block.timestamp;
  fill.blockNumber = event.block.number;
  fill.txHash = event.transaction.hash.toHexString();
  fill.save();
}

export function handleOrderCancelled(event: OrderCancelled): void {
  const id = orderIdHex(event.params.orderId);
  const order = LimitOrder.load(id);
  if (order == null) {
    // Cancel without a prior place in this subgraph (resync gap) — still record a stub.
    const marketAddr = addrId(event.params.market);
    const stub = new LimitOrder(id);
    if (Market.load(marketAddr) != null) {
      stub.market = marketAddr;
    }
    stub.marketAddress = marketAddr;
    stub.token = addrId(event.params.token);
    stub.user = addrId(event.params.user);
    stub.price = event.params.price;
    stub.amount = ZERO;
    stub.isBuy = false;
    stub.status = "cancelled";
    stub.createdAt = event.block.timestamp;
    stub.createdAtBlock = event.block.number;
    stub.cancelledAt = event.block.timestamp;
    stub.txHash = event.transaction.hash.toHexString();
    stub.save();
    return;
  }

  order.status = "cancelled";
  order.cancelledAt = event.block.timestamp;
  order.save();
}

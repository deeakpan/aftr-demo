import { RouterRedeemed, RouterRedeemedAndRepaid } from "../generated/Router/Router";
import { creditRedemption } from "./market";

export function handleRouterRedeemed(event: RouterRedeemed): void {
  creditRedemption(
    event.params.market,
    event.params.user,
    event.params.outcomeIndex,
    event.params.payoutAmount,
    event.params.shareAmount,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash.toHexString(),
    event.logIndex.toI32(),
  );
}

export function handleRouterRedeemedAndRepaid(event: RouterRedeemedAndRepaid): void {
  creditRedemption(
    event.params.market,
    event.params.user,
    event.params.outcomeIndex,
    event.params.payoutAmount,
    event.params.shareAmount,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash.toHexString(),
    event.logIndex.toI32(),
  );
}

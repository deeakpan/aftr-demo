import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  Staked,
  UnstakeInitiated,
  UnstakeCompleted,
  UnstakeCancelled,
  RewardsClaimed,
  FeesReceived,
} from "../generated/Vault/Vault";
import { Staker, RewardClaim, EpochFees } from "../generated/schema";
import { ZERO, addrId } from "./ids";

function loadOrCreateStaker(addr: Address): Staker {
  const id = addrId(addr);
  let s = Staker.load(id);
  if (s == null) {
    s = new Staker(id);
    s.stakedBalance = ZERO;
    s.pendingUnstake = ZERO;
    s.totalStaked = ZERO;
    s.totalUnstaked = ZERO;
    s.totalRewardsClaimed = ZERO;
    s.save();
  }
  return s as Staker;
}

export function handleStaked(event: Staked): void {
  const s = loadOrCreateStaker(event.params.user);
  s.stakedBalance = s.stakedBalance.plus(event.params.amount);
  s.totalStaked = s.totalStaked.plus(event.params.amount);
  s.save();
}

export function handleUnstakeInitiated(event: UnstakeInitiated): void {
  const s = loadOrCreateStaker(event.params.user);
  // Move from active stake to pending
  s.stakedBalance = s.stakedBalance.minus(event.params.amount);
  s.pendingUnstake = s.pendingUnstake.plus(event.params.amount);
  s.save();
}

export function handleUnstakeCompleted(event: UnstakeCompleted): void {
  const s = loadOrCreateStaker(event.params.user);
  s.pendingUnstake = s.pendingUnstake.minus(event.params.amount);
  s.totalUnstaked = s.totalUnstaked.plus(event.params.amount);
  s.save();
}

export function handleUnstakeCancelled(event: UnstakeCancelled): void {
  const s = loadOrCreateStaker(event.params.user);
  // Move back from pending to active
  s.pendingUnstake = s.pendingUnstake.minus(event.params.amount);
  s.stakedBalance = s.stakedBalance.plus(event.params.amount);
  s.save();
}

export function handleRewardsClaimed(event: RewardsClaimed): void {
  const s = loadOrCreateStaker(event.params.user);
  s.totalRewardsClaimed = s.totalRewardsClaimed.plus(event.params.amount);
  s.save();

  // Record individual claim
  const claimId = event.transaction.hash.toHexString()
    .concat("-")
    .concat(event.logIndex.toString());

  const claim = new RewardClaim(claimId);
  claim.staker = addrId(event.params.user);
  claim.token = addrId(event.params.token);
  claim.amount = event.params.amount;
  claim.timestamp = event.block.timestamp;
  // Epoch is not in this event — derive from block timestamp if needed.
  // For simplicity store 0; the vault's currentEpoch() can be queried off-chain.
  claim.epoch = ZERO;
  claim.save();
}

export function handleFeesReceived(event: FeesReceived): void {
  const tokenAddr = addrId(event.params.token);
  const epoch = event.params.epoch;
  const epochId = epoch.toString().concat("-").concat(tokenAddr);

  let ef = EpochFees.load(epochId);
  if (ef == null) {
    ef = new EpochFees(epochId);
    ef.epoch = epoch;
    ef.token = tokenAddr;
    ef.totalFees = ZERO;
    ef.stakerShare = ZERO;
    ef.treasuryShare = ZERO;
  }

  ef.totalFees = ef.totalFees.plus(event.params.total);
  ef.stakerShare = ef.stakerShare.plus(event.params.stakerShare);
  ef.treasuryShare = ef.treasuryShare.plus(event.params.treasuryShare);
  ef.save();
}

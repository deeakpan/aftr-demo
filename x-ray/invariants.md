# Invariant Map

> AFTR Parimutuel | a94c5b0 (`main`)

---

## §1 — Enforced Guards (Reference)

#### G-1
- **Check**: `require(initialized)` / `if (!initialized) revert NotInitialized()`
- **Location**: `AFTRVParimutuelMarket.sol` — all public state-changing functions
- **Purpose**: Prevents any market interaction before `initialize()` is called by the factory; guards against uninitialized market state being exploited.

#### G-2
- **Check**: `if (state != MarketState.OPEN) revert MarketNotOpen()`
- **Location**: `AFTRVParimutuelMarket.deposit`, `bootstrapLiquidity`
- **Purpose**: Ensures deposits only occur while market is in OPEN state; prevents deposits after UMA resolution is requested or after settlement.

#### G-3
- **Check**: `if (block.timestamp >= stakeEndTimestamp) revert StakePeriodEnded()`
- **Location**: `AFTRVParimutuelMarket.deposit`, `bootstrapLiquidity`
- **Purpose**: Enforces the trading window; no new positions after stake period ends.

#### G-4
- **Check**: `if (bootstrapped) revert AlreadyBootstrapped()`
- **Location**: `AFTRVParimutuelMarket.bootstrapLiquidity`
- **Purpose**: One-shot latch — bootstrap liquidity can only be called once per market.

#### G-5
- **Check**: `if (block.timestamp < resolveAfterTimestamp) revert TooEarlyToResolve()`
- **Location**: `AFTRVParimutuelMarket.settlePrice`, `requestEventResolution`
- **Purpose**: Prevents premature settlement; oracle must be read after the designated resolution window.

#### G-6
- **Check**: `require(answer > 0, "Answer")` + `require(block.timestamp - updatedAt <= maxPriceStaleness, "Stale")`
- **Location**: `AFTRVParimutuelMarket.settlePrice`
- **Purpose**: Guards against negative or stale Chainlink price being used for settlement.

#### G-7
- **Check**: `if (amount > staked - pending) revert InsufficientStake()`
- **Location**: `AFTRFeeVault.initiateUnstake`
- **Purpose**: Prevents initiating an unstake larger than the user's active (non-pending) stake balance.

#### G-8
- **Check**: `if (!isRewardToken[token]) revert NotRegisteredRewardToken()`
- **Location**: `AFTRFeeVault.receiveFees`, `notifyFees`, `notifyFeesETH`
- **Purpose**: Vault only accepts fees for registered tokens; prevents dust or unexpected tokens from entering the accounting system.

---

## §2 — Inferred Single-Contract Invariants

#### I-1
- **Property**: In `bootstrapLiquidity`, `priceOf(i)` is called before `realPool[i]` is updated for outcome `i`, meaning each outcome's share count is computed at a price that does not yet reflect the current iteration's pool addition.
- **Type**: Conservation / Ratio
- **Location**: `AFTRVParimutuelMarket.bootstrapLiquidity` — loop body calls `priceOf(i)` then `realPool[i] += per`
- **Derivation**: `priceOf(i)` reads `realPool[i]` at line N; `realPool[i] += per` at line N+2; for i>0, the price used to compute shares already includes prior iterations' pool additions but not the current one — this is consistent across all outcomes only if `per` is equal for all, which it is (totalAmount / n). However, the price for outcome 0 is computed before any pool is updated, while outcome N-1 is computed after N-1 pools have been updated. This creates a systematic price discrepancy across outcomes during bootstrap.
- **On-chain**: No — the guard `require(p > 0)` exists but does not enforce equal share distribution across outcomes.

#### I-2
- **Property**: `rewardPerTokenStored[token] - userRewardPerTokenPaid[token][user]` must never underflow.
- **Type**: Bound
- **Location**: `AFTRFeeVault._earned`
- **Derivation**: `rewardPerTokenStored[token]` only increases (via `_distributeFees`). `userRewardPerTokenPaid[token][user]` is set to `rewardPerTokenStored[token]` at the time of last interaction. Therefore the subtraction is safe **as long as the token is never removed and re-added**. `removeRewardToken` sets `isRewardToken[token] = false` and removes from array but does NOT reset `rewardPerTokenStored[token]`. If the same token address is later re-added via `addRewardToken`, `rewardPerTokenStored[token]` retains its old value — this is safe. However, if a token is removed, `rewardPerTokenStored` is not reset, and a new token at the same address would inherit the old accumulator — this is only a risk if token addresses are reused, which is unlikely but worth noting.
- **On-chain**: Yes — accumulator is monotonically increasing; removal does not reset it.

#### I-3
- **Property**: `unstakeRequests[user].availableAt` is always `>= block.timestamp + lockDuration` after any `initiateUnstake` call.
- **Type**: Temporal
- **Location**: `AFTRFeeVault.initiateUnstake` — `unstakeRequests[msg.sender].availableAt = block.timestamp + lockDuration`
- **Derivation**: Every call to `initiateUnstake` resets `availableAt` to `block.timestamp + lockDuration`, even when adding to an existing request. A user who calls `initiateUnstake(1)` then `initiateUnstake(1)` one second later has their lock extended by one second. This means the lock is always at least `lockDuration` from the most recent `initiateUnstake` call — the lock cannot be shortened by batching calls, but it can be extended indefinitely.
- **On-chain**: Yes — `availableAt` is always set to `block.timestamp + lockDuration`.

#### I-4
- **Property**: `totalStaked` equals the sum of all active (non-pending-unstake) sAFTR balances.
- **Type**: Conservation
- **Location**: `AFTRFeeVault` — `stake` increments, `initiateUnstake` decrements, `cancelUnstake` re-increments, `completeUnstake` does not touch `totalStaked`
- **Derivation**: Δ(totalStaked) = +amount on `stake`; -amount on `initiateUnstake`; +amount on `cancelUnstake`. sAFTR balance = staked - pending. Therefore `totalStaked = Σ(sAFTR.balanceOf(user) - unstakeRequests[user].amount)` across all users. `completeUnstake` burns sAFTR and does not change `totalStaked` (already decremented at `initiateUnstake`) — this is correct.
- **On-chain**: Yes — all write sites maintain the invariant.

---

## §3 — Inferred Cross-Contract Invariants

#### X-1
- **Property**: Protocol fees sent from `AFTRVParimutuelMarket` must reach `AFTRFeeVault.receiveFees()` and update `rewardPerTokenStored` atomically; a plain transfer bypasses the accumulator.
- **Caller side**: `AFTRVParimutuelMarket._sendProtocolFee` — calls `_supportsReceiveFees(feeRecipient)` via staticcall; if false, falls back to `_sendCollateral(feeRecipient, amount)` which is a plain ERC20 transfer.
- **Callee side**: `AFTRFeeVault.receiveFees` — updates `rewardPerTokenStored` via `_distributeFees`.
- **Gap**: If `_supportsReceiveFees` returns false (e.g., vault not yet deployed, ERC165 check fails, or feeRecipient is an EOA), fees are transferred but the accumulator is never updated — stakers receive no credit for those fees. The treasury also does not accrue them. The funds are simply held at `feeRecipient` with no accounting.
- **On-chain**: No — the fallback path exists and bypasses the accumulator.

#### X-2
- **Property**: `bootstrapFunder` in `AFTRVParimutuelMarket` should be the market creator, but is set to the factory address when `_seedMarket` is called.
- **Caller side**: `AFTRParimutuelMarketFactory._seedMarket` — calls `bootstrapLiquidity(bootstrapAmount, shareRecipient)` from the factory contract; `msg.sender` inside `bootstrapLiquidity` is the factory.
- **Callee side**: `AFTRVParimutuelMarket.bootstrapLiquidity` — sets `bootstrapFunder = msg.sender` (the factory).
- **Gap**: `bootstrapFunder` is set to the factory address, not the market creator. If any future logic rewards or references `bootstrapFunder`, it will point to the factory rather than the creator. Currently `bootstrapFunder` is only stored and emitted — no reward logic uses it — but this is a latent inconsistency.
- **On-chain**: No — `bootstrapFunder` is the factory, not the creator, in all atomically-seeded markets.

---

## §4 — Economic Invariants

#### E-1
- **Property**: Total collateral in a market at settlement equals `Σ realPool[i]` (all outcomes); this is distributed as `winReal + distributable` to winners, with no leakage.
- **Derivation**: From I-4 (conservation of pool accounting) + settlement math in `_finalizeSettlement`: `distributable = Σ realPool[j] for j != winIdx`; `redemptionRate = (realPool[winIdx] + distributable) * 1e18 / winSupply = Σ realPool[i] * 1e18 / winSupply`. Total payout = `winSupply * redemptionRate / 1e18 = Σ realPool[i]`. Conservation holds exactly (no rounding leakage to protocol at settlement).
- **Exception**: If `winSupply == 0`, `Σ realPool[i]` is sent to `feeRecipient` — this is the only path where settlement collateral leaves to a non-winner address.
- **On-chain**: Yes — for the normal path. No for the zero-winner edge case (intentional but worth confirming).

# X-Ray Report

> AFTR Parimutuel | 3601 nSLOC | a94c5b0 (`main`) | Hardhat | 08/05/26

---

## 1. Protocol Overview

**What it does:** A virtual-reserve parimutuel prediction market protocol where users stake collateral on outcomes, fees are distributed to a staking vault, and markets settle via Chainlink price feeds or UMA optimistic oracle.

- **Users**: Traders deposit collateral to buy outcome shares; stakers lock AFTR tokens to earn protocol fees
- **Core flow**: Creator deploys market + seeds liquidity atomically → traders deposit collateral → market settles → winners redeem shares for collateral
- **Key mechanism**: Virtual-reserve AMM pricing (`(virtualReserve + realPool[i]) / totalWeight`) — prices shift as real pools fill, virtual reserve sets initial odds
- **Token model**: Outcome tokens (ERC20, per-market, per-outcome); AFTR governance token; sAFTR soul-bound receipt token
- **Admin model**: Factory owner controls collateral whitelist, fee recipient, oracle addresses, deployer; no timelock on any setter

For a visual overview see [architecture.svg](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Market Core | AFTRVParimutuelMarket | ~620 | Pricing, deposits, settlement, redemption |
| Factory | AFTRParimutuelMarketFactory, AFTRParimutuelDeployer, AFTRParimutuelBatchFactory | ~480 | Market deployment, bootstrap seeding |
| Staking Vault | AFTRFeeVault, sAFTRToken | ~380 | Fee distribution, AFTR staking |
| Router | AFTRMarketDebtRouter | ~160 | Deposit/redeem proxy with DRP integration |
| Tokens | AFTRToken, AFTROutcomeToken | ~80 | Governance token, outcome shares |

### How It Fits Together

The core trick: a virtual reserve keeps prices non-zero at market open; real deposits shift prices; fees are deducted per-trade and pushed atomically to the vault accumulator.

### Market Creation → Seed

```
AFTRParimutuelMarketFactory.createPriceMarket()
  ├─ AFTRParimutuelDeployer.deployPriceMarket()   *deploys market + outcome tokens*
  ├─ _wireMarket()                                 *transfers token ownership, calls initialize()*
  ├─ _seedMarket()                                 *pulls bootstrapAmount from caller, calls bootstrapLiquidity()*
  └─ _register()                                   *emits MarketCreated with creator*
```

### Trade → Fee Flow

```
AFTRVParimutuelMarket.deposit()
  ├─ pull collateral from msg.sender
  ├─ _sendCollateral(creator, creatorFee)          *0.3% direct to creator*
  ├─ _sendProtocolFee(protocolFee)                 *1.2% — checks ERC165 on feeRecipient*
  │    ├─ [vault] forceApprove + receiveFees()     *accumulator updated atomically*
  │    └─ [EOA]  plain transfer
  ├─ priceOf() → compute shares on netAmount
  └─ mint outcome tokens to recipient
```

### Settlement → Redemption

```
AFTRVParimutuelMarket.settlePrice() / settleWithUmaResult()
  └─ _finalizeSettlement()
       ├─ sum loser pools → distributable
       └─ redemptionRate = (winReal + distributable) * 1e18 / winSupply

AFTRVParimutuelMarket.redeem()
  ├─ burnFrom(msg.sender, shareAmount)
  └─ _sendCollateral(msg.sender, payout)           *payout = shares * redemptionRate / 1e18*
```

### Vault Staking

```
AFTRFeeVault.stake()  →  sAFTRToken.mint()  →  totalStaked++
AFTRFeeVault.receiveFees()  →  _distributeFees()  →  rewardPerTokenStored[token] += stakerShare/totalStaked
AFTRFeeVault.claimRewards()  →  _earned()  →  _sendToken()
AFTRFeeVault.initiateUnstake()  →  [lockDuration]  →  completeUnstake()  →  sAFTRToken.burn()
```

---

## 2. Threat & Trust Model

> **Bullet brevity rule:** one tight sentence per bullet — code ref + concern + what to trace.

### Protocol Threat Profile

> Protocol classified as: **Derivatives/Prediction Market** with **Yield Aggregator (vault)** characteristics

Parimutuel markets share oracle-dependency and settlement-timing risks with derivatives; the fee vault introduces share-accounting and reward-distribution risks typical of yield aggregators.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Factory Owner | Trusted (EOA/multisig — no timelock) | All instant: `setFeeRecipient`, `setOptimisticOracleV2`, `addSupportedCollateral`, `setMarketDeployer`, `setBatchExecutor` — any can redirect fees or break market creation |
| Market Creator | Bounded (any address, self-selected) | Receives 0.3% of all trades on their market; set immutably at deploy |
| Vault Owner | Trusted (same as factory owner likely) | Instant: `addRewardToken`, `removeRewardToken`, `withdrawTreasury` — can drain treasury at will |
| Trader | Untrusted | `deposit()`, `redeem()`, `redeemAndRepayDebt()`, `bootstrapLiquidity()` (first call only) |
| Staker | Untrusted | `stake()`, `initiateUnstake()`, `completeUnstake()`, `cancelUnstake()`, `claimRewards()` |
| Anyone | Untrusted | `settlePrice()`, `requestEventResolution()`, `settleWithUmaResult()`, `fundUmaBond()` |

**Adversary Ranking:**

1. **Oracle manipulator** — Chainlink feed is the sole source of truth for PRICE market settlement; stale or manipulated answer determines winner for all deposited collateral.
2. **Compromised factory owner** — Can redirect `feeRecipient` to attacker address, swap `optimisticOracleV2` to malicious contract, or set `marketDeployer` to deploy backdoored markets — all instantly with no timelock.
3. **Malicious market creator** — Any address can create a market; creator receives 0.3% of every trade and is set immutably; a creator could front-run their own market or create markets with misleading metadata.
4. **UMA oracle manipulator** — For EVENT markets, the OO proposer/disputer bond and liveness window can be gamed if `umaProposerBond` is set too low.
5. **Vault reward manipulator** — Large staker who stakes just before a large fee batch arrives and unstakes immediately after, extracting disproportionate rewards.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Factory owner → all protocol config** — No timelock; instant `setFeeRecipient` can redirect 1.2% of all future trades to attacker; instant `setOptimisticOracleV2` can point EVENT markets at a malicious oracle. *Git signal: access control rewritten in commit 1e9fc4c (score 10).*

- **Market → feeRecipient (vault)** — `_supportsReceiveFees` uses a staticcall ERC165 check; if the vault is upgraded or replaced, the check may silently fall back to plain transfer, breaking atomic accumulator updates. Worth confirming the fallback path is safe.

- **Vault → stakeToken** — Vault holds all staked AFTR; `withdrawTreasury` is instant with no delay; owner can drain treasury share of any registered reward token at any time.

- **UMA OO → EVENT market settlement** — `settleWithUmaResult()` trusts `settleAndGetPrice()` return value; the market has no dispute window of its own beyond UMA's liveness.

### Key Attack Surfaces

- **`setFeeRecipient` with no timelock** — `AFTRParimutuelMarketFactory.sol:setFeeRecipient` changes where 1.2% of all future trade fees go; worth confirming there is no delay or multisig requirement before this takes effect on live markets.

- **`_supportsReceiveFees` staticcall fallback** &nbsp;&#91;[X-1](invariants.md#x-1)&#93; — `AFTRVParimutuelMarket._supportsReceiveFees` returns false on any revert or unexpected return; if vault is non-conforming, fees silently transfer as plain ERC20 without updating the accumulator — worth tracing what happens to staker rewards in that path.

- **`priceOf()` called after `realPool` update in `bootstrapLiquidity`** &nbsp;&#91;[I-1](invariants.md#i-1)&#93; — `bootstrapLiquidity` calls `priceOf(i)` before updating `realPool[i]`, so price is computed on stale pool state for outcomes after index 0; worth checking whether this creates a share-minting discrepancy across outcomes.

- **`initiateUnstake` lock reset** &nbsp;&#91;[I-3](invariants.md#i-3)&#93; — `AFTRFeeVault.initiateUnstake` resets `availableAt = block.timestamp + lockDuration` on every call even when adding to an existing request; a user who calls it repeatedly can extend their own lock indefinitely but cannot shorten it — worth confirming the intended behavior.

- **`rewardPerTokenStored` underflow in `_earned`** &nbsp;&#91;[I-2](invariants.md#i-2)&#93; — `_earned` computes `rewardPerTokenStored[token] - userRewardPerTokenPaid[token][user]`; if a reward token is removed and re-added (resetting the accumulator to 0 while user snapshots remain at old values), this subtraction underflows — worth tracing `removeRewardToken` + `addRewardToken` sequence.

- **`_finalizeSettlement` with zero `winSupply`** — `AFTRVParimutuelMarket._finalizeSettlement` sends `winReal + distributable` to `feeRecipient` when no winning shares exist; worth confirming this is intentional and that `feeRecipient` (the vault) handles unexpected inbound transfers correctly.

- **`forceApprove` before `receiveFees` in `_sendProtocolFee`** — `AFTRVParimutuelMarket._sendProtocolFee` calls `forceApprove(feeRecipient, amount)` then `receiveFees()`; if `receiveFees` reverts after the approval is set, the approval remains — worth checking whether a subsequent call can exploit the residual allowance.

- **`bootstrapLiquidity` callable by factory during `_seedMarket`** — `_seedMarket` calls `bootstrapLiquidity` on behalf of `msg.sender` (the market creator); the `bootstrapFunder` is set to the factory address, not the creator — worth confirming this is intentional and that no bootstrap-funder-specific logic remains.

- **Chainlink staleness window** — `AFTRVParimutuelMarket.settlePrice` checks `block.timestamp - updatedAt <= maxPriceStaleness`; `maxPriceStaleness` is set at deploy and immutable — worth confirming the value is appropriate for the feed's heartbeat.

- **`redeemAndRepayDebt` DRP trust** — `AFTRVParimutuelMarket.redeemAndRepayDebt` calls `drp.repayDebt(msg.sender, ...)` with a user-supplied `drp` address; the only check is `collateralAddress == IDRPDebtRepay(drp).usdead()` — worth tracing whether a malicious `drp` contract can exploit this.

### Protocol-Type Concerns

**As a Prediction Market:**
- `priceOf()` uses integer division `(virtualReserve + realPool[i]) * 1e18 / totalWeight`; with small `virtualReserve` and large `realPool` imbalance, rounding can produce 0 price for minority outcomes — `require(p > 0)` guards this but worth checking edge cases near zero.
- Settlement is pull-based and permissionless; anyone can call `settlePrice()` after `resolveAfterTimestamp` — worth confirming there is no MEV incentive to delay or front-run settlement.

**As a Yield Aggregator (vault):**
- `_earned` uses `receiptToken.balanceOf(user) - unstakeRequests[user].amount` for effective stake; sAFTR is soul-bound so balance manipulation is blocked, but worth confirming `balanceOf` cannot be inflated through any path.
- No minimum stake enforced; dust stakes can dilute the accumulator precision at very low `totalStaked` values.

### Temporal Risk Profile

**Deployment & Initialization:**
- `AFTRParimutuelMarketFactory` constructor sets `feeRecipient` but `marketDeployer` starts as `address(0)` — markets cannot be created until `setMarketDeployer` is called; worth confirming this is done atomically in the deployment script.
- `AFTRFeeVault` deploys `sAFTRToken` in its constructor; the vault address is the sole owner — no initialization window, but `rewardTokens` array starts empty so fees received before `addRewardToken` are silently accepted by `receive()` and never distributed.

**Market Stress:**
- Virtual reserve is immutable; under extreme one-sided betting, minority outcome price approaches `virtualReserve / totalWeight` — at very low virtual reserve this can round to 0, blocking deposits on that outcome.

### Composability & Dependency Risks

> **Chainlink AggregatorV3** — via `AFTRVParimutuelMarket.settlePrice`
> - Assumes: `answer > 0`, `updatedAt` within `maxPriceStaleness`
> - Validates: both checks present
> - Mutability: Chainlink-controlled feed address (immutable in market)
> - On failure: revert — market cannot settle until feed recovers

> **UMA OptimisticOracleV2** — via `AFTRVParimutuelMarket.requestEventResolution` / `settleWithUmaResult`
> - Assumes: OO returns valid price within `[0, numOutcomes-1]` range for MULTIPLE_CHOICE, or `1e18`/other for YES_OR_NO
> - Validates: `UmaInvalidResolution` guards on `type(int256).min/max`; custom identifier path has index scaling
> - Mutability: Set by factory owner — can be changed to malicious contract instantly
> - On failure: revert on `settleWithUmaResult`; market stuck in `AWAITING_UMA` state permanently

> **DRP (DeaderalReserveProtocol)** — via `AFTRMarketDebtRouter.redeemAndRepayForSelf`
> - Assumes: `drp.usdead()` returns the correct USDeAD address; `repayDebt` behaves correctly
> - Validates: collateral must equal `usdead` address
> - Mutability: Immutable in router constructor
> - On failure: revert

**Token Assumptions:**
- ERC20 collateral: assumes standard transfer semantics — fee-on-transfer tokens will cause accounting errors in `deposit()` since `amount` is used but less arrives
- sAFTR: assumes `transfer`/`transferFrom` always revert — confirmed by soul-bound override

---

## 3. Invariants

> ### 📋 Full invariant map: **[invariants.md](invariants.md)**
>
> - **8 Enforced Guards** (`G-1` … `G-8`) — per-call preconditions
> - **4 Single-Contract Invariants** (`I-1` … `I-4`) — Conservation, Bound, StateMachine, Temporal
> - **2 Cross-Contract Invariants** (`X-1` … `X-2`) — vault/market fee path, factory/market creator
> - **1 Economic Invariant** (`E-1`) — total collateral conservation across market lifecycle
>
> **On-chain=No** blocks are the high-signal ones — each is simultaneously an invariant and a potential bug.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | Root README present |
| NatSpec | ~60 annotations | Good coverage on market and vault; deployer and batch factory sparse |
| Spec/Whitepaper | Missing | No formal spec; design intent inferred from code |
| Inline Comments | Adequate | Key mechanisms commented; fee split logic well-documented |

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 0 | File scan |
| Test functions | 0 | File scan |
| Line coverage | Unavailable — no test files found | Coverage tool |
| Branch coverage | Unavailable — no test files found | Coverage tool |

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | 0 | None |
| Stateless Fuzz | 0 | None |
| Stateful Fuzz (Foundry) | 0 | None |
| Formal Verification | 0 | None |

### Gaps

**Critical:** Zero test coverage across all 3601 nSLOC. No unit, fuzz, or invariant tests exist. This is the highest-priority gap before any audit or deployment. Priority areas given complexity:
1. `AFTRVParimutuelMarket` — pricing math, fee deduction, settlement, redemption rate
2. `AFTRFeeVault` — reward accumulator correctness, unstake lock, multi-token accounting
3. `AFTRParimutuelMarketFactory._seedMarket` — ETH vs ERC20 paths, bootstrap atomicity

---

## 6. Developer & Git History

> Repo shape: normal_dev — 23 commits over 31 days (2026-03-31 → 2026-05-01); 6 commits touch source files

### Contributors

| Author | Commits | % of Source Changes |
|--------|--------:|--------------------:|
| deeakpan | 23 | ~100% |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 1 | Single-developer — no peer review |
| Merge commits | 0 of 23 (0%) | No formal review process detected |
| Repo age | 2026-03-31 → 2026-05-01 | 31 days |
| Recent source activity (30d) | 6 source commits | Active development |
| Test co-change rate | 0% | No test files modified in any commit |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| contracts/core/AFTRVParimutuelMarket.sol | High | Core pricing + fee logic — highest complexity |
| contracts/factory/AFTRParimutuelMarketFactory.sol | High | Bootstrap + creator logic added recently |
| contracts/core/AFTRMarketDebtRouter.sol | 2 | Access control rewritten in score-10 commit |

### Security-Relevant Commits

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| 1e9fc4c | 2026-04-30 | bump | 10 | Rewrites access control + token transfer logic in DebtRouter and DRP |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| access_control | 2 | AFTRMarketDebtRouter.sol, AFTRParimutuelMarketFactory.sol |
| fund_flows | 3 | AFTRVParimutuelMarket.sol, AFTRFeeVault.sol |

### Technical Debt Markers

None detected.

### Security Observations

- **Single-developer, zero peer review** — 100% of commits from one author with no merge commits; no second set of eyes on any change.
- **Zero tests across entire codebase** — 3601 nSLOC with no test files; no regression safety net for any of the recent fee/creator/vault changes.
- **Score-10 commit (1e9fc4c) has no test change** — access control and token transfer logic rewritten in `AFTRMarketDebtRouter` and `DeaderalReserveProtocol` with zero test coverage added.
- **All major features added in last 31 days** — creator fees, atomic bootstrap, vault, AFTR token all added in a single development sprint with no audit history.
- **No timelock on any admin function** — factory owner can redirect fees, swap oracle, or change deployer instantly.
- **`feeRecipient` mutable post-deploy** — all live markets point to the same `feeRecipient` immutably baked at deploy time; changing factory `feeRecipient` only affects future markets, but the vault address in existing markets is permanent.

### Cross-Reference Synthesis

- **`AFTRVParimutuelMarket` is both the highest-complexity and highest-churn file** — pricing math, fee deduction, ERC165 vault detection, and settlement all live here with zero test coverage → highest-leverage review target.
- **Score-10 commit aligns with access control surface** — `AFTRMarketDebtRouter` access control rewrite (1e9fc4c) has no tests and touches the fund-flow path for DRP debt repayment → worth manual diff.
- **Vault reward accumulator has no tests and no prior audit** — `AFTRFeeVault` is entirely new code with the classic reward-per-token pattern; the `removeRewardToken` + re-add underflow risk (I-2) is unverified by any test.
- **Bootstrap atomicity is new and untested** — `_seedMarket` was added recently; the ETH path (`msg.value == bootstrapAmount`) has a subtle interaction with the factory being the `bootstrapFunder` rather than the creator.

---

## X-Ray Verdict

**FRAGILE** — Zero test coverage across 3601 nSLOC, single developer, no peer review, and no timelock on admin functions.

**Structural facts:**
1. 3601 nSLOC across 5 subsystems; 0 test files, 0 test functions
2. Single developer (deeakpan), 0 merge commits — no peer review process
3. All admin functions execute instantly with no timelock or multisig requirement
4. Score-10 security-relevant commit (1e9fc4c) with no corresponding test changes
5. `feeRecipient` in deployed markets is immutable; factory `feeRecipient` only affects future markets

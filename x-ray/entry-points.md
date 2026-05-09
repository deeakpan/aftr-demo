# Entry Point Map

> AFTR Parimutuel | 22 entry points | 12 permissionless | 0 role-gated | 10 admin-only

---

## Protocol Flow Paths

### Setup (Owner)

`Factory.setMarketDeployer()` → `Factory.addSupportedCollateral()` → `Factory.setFeeRecipient(vault)`
`Vault.addRewardToken(USDC)` → `Vault.addRewardToken(address(0))`  ◄── must happen before any market trades

### Market Creation (Anyone)

`[setup above]` → `IERC20.approve(factory, bootstrapAmount)` → `Factory.createPriceMarket(params)`
  ├─→ deploys market + outcome tokens
  ├─→ `Market.initialize()`  ◄── onlyFactory
  ├─→ `Market.bootstrapLiquidity()`  ◄── factory is msg.sender; bootstrapFunder = factory
  └─→ emits `MarketCreated(market, kind, collateral, ..., creator=msg.sender)`

### Trading (Anyone)

`[market created above]` → `[block.timestamp < stakeEndTimestamp]` → `Market.deposit(outcomeIndex, amount, recipient, minSharesOut)`
  ├─→ fees split: 0.3% → creator, 1.2% → vault.receiveFees()
  └─→ outcome tokens minted to recipient

### Settlement (Anyone, after resolveAfterTimestamp)

`[stakeEndTimestamp passed]` → `[resolveAfterTimestamp passed]`
  ├─→ PRICE: `Market.settlePrice()`  ◄── reads Chainlink feed
  └─→ EVENT: `Market.requestEventResolution()` → `[UMA liveness]` → `Market.settleWithUmaResult()`

### Redemption (Winner)

`[market settled]` → `Market.redeem(outcomeIndex, shareAmount)`
  └─→ burns outcome tokens, sends collateral at redemptionRate

### Staking (Anyone)

`AFTR.approve(vault, amount)` → `Vault.stake(amount)` → receive sAFTR 1:1
`Vault.initiateUnstake(amount)` → `[lockDuration passes]` → `Vault.completeUnstake()`
`Vault.claimRewards()`  ◄── anytime after fees have been received

---

## Permissionless

### `AFTRVParimutuelMarket.deposit()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any trader |
| Parameters | outcomeIndex (user-controlled), amount (user-controlled), recipient (user-controlled), minSharesOut (user-controlled) |
| Call chain | `→ priceOf() → _sendCollateral(creator) → _sendProtocolFee() → [vault.receiveFees() or transfer] → mint(recipient)` |
| State modified | `realPool[outcomeIndex]`, outcome token `totalSupply` |
| Value flow | Tokens: sender → Market (net 98.5%) + creator (0.3%) + vault (1.2%) |
| Reentrancy guard | yes |

### `AFTRVParimutuelMarket.bootstrapLiquidity()`

| Aspect | Detail |
|--------|--------|
| Visibility | external payable, nonReentrant |
| Caller | Factory (via `_seedMarket`) — permissionless in isolation but gated by `AlreadyBootstrapped` |
| Parameters | totalAmount (caller-controlled), shareRecipient (caller-controlled) |
| Call chain | `→ priceOf(i) → realPool[i] += per → mint(shareRecipient)` (loop) |
| State modified | `realPool[0..n]`, `bootstrapFunder`, `bootstrapped` |
| Value flow | Tokens: sender → Market |
| Reentrancy guard | yes |

### `AFTRVParimutuelMarket.redeem()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any winner |
| Parameters | outcomeIndex (user-controlled), shareAmount (user-controlled) |
| Call chain | `→ burnFrom(msg.sender) → _sendCollateral(msg.sender)` |
| State modified | outcome token `totalSupply` |
| Value flow | Tokens: Market → msg.sender |
| Reentrancy guard | yes |

### `AFTRVParimutuelMarket.redeemAndRepayDebt()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any winner with DRP debt |
| Parameters | outcomeIndex, shareAmount, drp (user-supplied address), vaultCollateralToken, debtToBurn |
| Call chain | `→ burnFrom → _sendCollateral → drp.repayDebt(msg.sender)` |
| State modified | outcome token `totalSupply` |
| Value flow | Tokens: Market → msg.sender; DRP pulls debt repayment from caller |
| Reentrancy guard | yes |

### `AFTRVParimutuelMarket.settlePrice()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone (after resolveAfterTimestamp) |
| Parameters | none |
| Call chain | `→ chainlinkFeed.latestRoundData() → _winningOutcomePrice() → _finalizeSettlement()` |
| State modified | `state`, `winningOutcomeIndex`, `redemptionRate`, `settlementTimestamp` |
| Value flow | None (fees already collected per-trade) |
| Reentrancy guard | yes |

### `AFTRVParimutuelMarket.requestEventResolution()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone (after resolveAfterTimestamp) |
| Parameters | none |
| Call chain | `→ optimisticOracleV2.requestPrice() → setCustomLiveness() → setBond() → setEventBased()` |
| State modified | `state = AWAITING_UMA`, `umaRequestTimestamp` |
| Value flow | None |
| Reentrancy guard | yes |

### `AFTRVParimutuelMarket.settleWithUmaResult()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone (after UMA liveness) |
| Parameters | none |
| Call chain | `→ optimisticOracleV2.settleAndGetPrice() → _winningOutcomeFromUma() → _finalizeSettlement()` |
| State modified | `state`, `winningOutcomeIndex`, `redemptionRate`, `settlementTimestamp` |
| Value flow | None |
| Reentrancy guard | yes |

### `AFTRFeeVault.stake()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant, updateRewards |
| Caller | Any AFTR holder |
| Parameters | amount (user-controlled) |
| Call chain | `→ stakeToken.safeTransferFrom → totalStaked++ → receiptToken.mint()` |
| State modified | `totalStaked`, sAFTR `totalSupply`, `pendingRewards`, `userRewardPerTokenPaid` |
| Value flow | Tokens: sender → Vault |
| Reentrancy guard | yes |

### `AFTRFeeVault.initiateUnstake()` / `completeUnstake()` / `cancelUnstake()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant, updateRewards |
| Caller | Any staker |
| Parameters | amount (user-controlled for initiate) |
| Call chain | initiate: `totalStaked--`; complete: `receiptToken.burn → stakeToken.transfer`; cancel: `totalStaked++` |
| State modified | `totalStaked`, `unstakeRequests`, sAFTR balance |
| Value flow | complete: Tokens: Vault → msg.sender |
| Reentrancy guard | yes |

### `AFTRFeeVault.claimRewards()` / `claimReward(token)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant, updateRewards |
| Caller | Any staker |
| Parameters | token (user-controlled for single-token claim) |
| Call chain | `→ _earned() → _sendToken(msg.sender)` |
| State modified | `pendingRewards`, `userRewardPerTokenPaid` |
| Value flow | Tokens: Vault → msg.sender |
| Reentrancy guard | yes |

### `AFTRParimutuelMarketFactory.createPriceMarket()` / `createEventMarket()`

| Aspect | Detail |
|--------|--------|
| Visibility | external payable |
| Caller | Anyone |
| Parameters | PriceMarketParams / EventMarketParams (fully user-controlled) |
| Call chain | `→ deployPriceMarket() → _wireMarket() → _seedMarket() → _register()` |
| State modified | `markets[]`, `isMarket`, `_marketOutcomeTokens` |
| Value flow | Tokens: msg.sender → Market (bootstrapAmount) |
| Reentrancy guard | no — relies on deployer/market guards |

---

## Admin-Only

| Function | Contract | Instant? | Effect |
|----------|----------|----------|--------|
| `setFeeRecipient(r)` | Factory | Yes | Redirects 1.2% protocol fee for all future markets |
| `setOptimisticOracleV2(oo)` | Factory | Yes | Changes UMA oracle for all future EVENT markets |
| `setBatchExecutor(executor)` | Factory | Yes | Grants market creation rights to another contract |
| `setMarketDeployer(d)` | Factory | Yes | Changes which contract deploys markets and tokens |
| `setUmaBondCurrency(c)` | Factory | Yes | Changes default UMA bond token |
| `addSupportedCollateral(token)` | Factory | Yes | Whitelists a new collateral token |
| `removeSupportedCollateral(token)` | Factory | Yes | Removes a collateral token from whitelist |
| `addRewardToken(token)` | Vault | Yes | Registers a new reward token for fee distribution |
| `removeRewardToken(token)` | Vault | Yes | Stops accepting fees for a token |
| `withdrawTreasury(token, to)` | Vault | Yes | Withdraws accumulated treasury share |

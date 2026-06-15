# Fees

All rates below apply to **pool trades** (market buys) unless noted.

## Trading fees (per pool deposit)

| Recipient | Rate | Notes |
|-----------|------|-------|
| **Total** | **1.5%** | Deducted before shares are calculated |
| Market creator | 0.3% | Paid to creator wallet on each trade |
| Protocol | 1.2% | Routed through fee vault |

### Example

You market-buy with **1,000 USDC**:

| | Amount |
|---|--------|
| Total fee | 15 USDC |
| Creator receives | 3 USDC |
| Protocol receives | 12 USDC |
| Enters pool for shares | 985 USDC |

The trade panel’s share estimate uses the post-fee amount.

## Protocol fee distribution

Of the **1.2%** protocol fee on each trade:

| Destination | Rate (of trade notional) |
|-------------|------------------------|
| MONDO stakers | 0.2% |
| Treasury (vault rules) | 1.0% |

Staker rewards are distributed **pro-rata** among all sMONDO holders in the vault.

## What is not charged

| Action | Trading fee? |
|--------|--------------|
| Claiming winnings after settlement | No additional 1.5% |
| Staking MONDO | No trading fee (vault deposit) |
| Withdrawing MONDO from vault | No trading fee |
| Wallet gas | Network cost only — paid to validators, not Mondalore |

## Limit orders

Limit order matching may involve escrow and fills at agreed prices. The **1.5% pool fee** applies specifically when collateral enters the parimutuel pool via market buy. Limit order economics follow the order book rules shown in the app.

## Creator earnings

Creators do not need a separate claim step for the 0.3% — it is sent on each qualifying trade automatically to the creator address set at market deployment.

## Fee changes

Fee rates are set at the protocol level for this deployment. If rates change in a future version, the in-app trade panel and these docs should be updated together.

[Staking rewards →](../staking/how-staking-works.md)

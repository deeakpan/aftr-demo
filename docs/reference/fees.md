# Fees

All rates below apply to **pool trades** (market buys) unless noted.

## Trading fees (per pool deposit)

| Recipient | Rate | Notes |
|-----------|------|-------|
| **Total** | **1.0%** | Deducted before shares are calculated |
| Market creator | 0.25% | Paid to creator address on each trade |
| Platform / distribution / treasury | 0.75% | Equal 0.25% shares (any unset recipient pays the creator) |

### Example

You market-buy with **1,000 USDC**:

| | Amount |
|---|--------|
| Total fee | 10 USDC |
| Creator receives | 2.5 USDC |
| Other fee shares | 7.5 USDC |
| Enters pool for shares | 990 USDC |

The trade panel’s share estimate uses the post-fee amount.

## What is not charged

| Action | Trading fee? |
|--------|--------------|
| Claiming winnings after settlement | No additional 1% |
| Wallet gas | Network cost only — paid to validators, not Zedkr |

## Limit orders

Limit order matching may involve escrow and fills at agreed prices. The **1% pool fee** applies specifically when collateral enters the FPMM pool via market buy. Limit order economics follow the order book rules shown in the app.

## Creator earnings

Creators do not need a separate claim step for the 0.25% — it is sent on each qualifying trade automatically to the creator address set at market deployment.

## Fee changes

Fee rates are set at the protocol level for this deployment. If rates change in a future version, the in-app trade panel and these docs should be updated together.

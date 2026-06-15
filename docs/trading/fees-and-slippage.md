# Fees & slippage

## Trading fee

Every **market trade** (pool buy) charges **1.5%** of the amount you deposit.

That fee is split:

| Recipient | Share of trade amount |
|-----------|----------------------|
| Market creator | 0.3% |
| Protocol | 1.2% |

The fee is deducted **before** shares are calculated. The share estimate in the trade panel already accounts for this.

**Example:** You deposit 100 USDC. After the 1.5% fee, 98.5 USDC goes into the pool for share calculation. You pay 1.5 USDC total in fees.

Limit orders may involve separate matching economics; the 1.5% pool fee applies to pool deposits specifically.

## Why fees exist

- **Creator fee** rewards people who launch markets and seed liquidity.
- **Protocol fee** supports the platform and flows partly to **MONDO stakers** (see [Staking](../staking/README.md)).

Full breakdown: [Reference — Fees](../reference/fees.md).

## Slippage

**Slippage tolerance** protects you from bad fills when the pool moves between submission and confirmation.

When you trade, the app sets a **minimum shares** threshold based on your slippage setting. If the pool price moves adversely beyond that tolerance, the transaction fails instead of giving you far fewer shares than quoted.

### Adjusting slippage

Use the slippage control in the trade panel to cycle through presets (e.g. tighter vs looser). Tighter slippage is safer but more likely to fail in volatile moments. Looser slippage confirms more often but with more price risk.

### When slippage matters most

- Large trades relative to pool size
- Active markets right after news
- Periods when many transactions hit the pool at once

## Gas

Network **gas** is paid to validators for processing your transaction. Gas is separate from Mondalore fees and varies with network congestion. You pay gas in the network’s native token.

## No hidden pool fee at settlement

The 1.5% is charged on **entry** (pool deposit). Settlement redemption does not apply an additional trading fee to winners — you redeem shares for collateral according to the market’s settlement rules.

## Next

[Tracking positions](../positions/tracking-positions.md)

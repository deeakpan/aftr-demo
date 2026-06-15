# Market vs limit orders

Mondalore supports two order styles. They serve different goals.

## Market trade (buy)

| | |
|---|---|
| **Action** | Buy outcome shares immediately |
| **Price** | Whatever the pool price is right now |
| **Speed** | Fills as soon as your transaction confirms |
| **Best for** | Entering a position quickly |

A market trade adds collateral to the pool for your chosen outcome. The pool’s internal pricing formula determines how many shares you mint. As more people buy the same outcome, its implied probability rises and new buyers receive fewer shares per dollar — classic parimutuel behavior.

You can only **buy** via market trade (pool deposit). You cannot market-sell back into the pool.

## Limit orders (buy or sell)

| | |
|---|---|
| **Action** | Place an order at a price you choose |
| **Price** | You set the limit price |
| **Speed** | Fills when another trader matches you |
| **Best for** | Better entries, exiting a position by selling shares |

### Limit buy

You offer to buy outcome shares at or below your limit price. Your collateral is held in escrow until the order fills or you cancel.

### Limit sell

You offer to sell outcome shares you already own at or above your limit price. Your shares are held in escrow until filled or cancelled.

Limit orders appear in the **order book** on the market page — bids on one side, asks on the other.

## Which should I use?

- **New to the market, want in now** → Market buy
- **Want a specific price** → Limit buy
- **Want to exit before settlement** → Limit sell
- **No rush, prefer to wait for a match** → Limit order

## Partial fills

Limit orders can fill partially over time as matching orders arrive. Unfilled remainder stays on the book until you cancel or it fully executes.

## Order book visibility

On binary markets, the order book is shown for the selected outcome. On multi-outcome markets, open the activity / order book section under the outcome you care about.

## Important distinction

| | Market trade | Limit order |
|---|--------------|-------------|
| Touches the pool | Yes | Only when matched |
| Can sell shares | No | Yes (limit sell) |
| Immediate | Yes | When matched |

[Understanding prices & probability →](understanding-prices.md)

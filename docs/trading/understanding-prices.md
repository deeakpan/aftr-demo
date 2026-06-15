# Understanding prices & probability

Mondalore markets use a **parimutuel pool** model. There is no traditional order-book mid price for pool trades — instead, everyone’s collateral sits in shared pools per outcome, and shares are minted based on the pool’s current weights.

## Probability percentage

The percentage shown next to each outcome is an **implied probability** derived from how much collateral sits on that side relative to all outcomes.

- If Yes shows **70%** and No shows **30%**, the pool collectively prices Yes as the more likely result.
- Percentages are not guarantees — they reflect trader sentiment and capital at this moment.
- When someone buys Yes, Yes’s share of the pool grows and its displayed probability typically increases.

## Price per share

When you enter a trade amount, the app estimates **shares** and an **effective price per share**. This price moves with the pool:

- Buying a popular outcome → you pay more per share (you get fewer shares per dollar).
- Buying an unpopular outcome → you pay less per share (more shares per dollar if it wins).

If your outcome wins, your payout depends on how many winning shares exist and how much collateral is available for redemption. Early buyers on the winning side can earn more than late buyers on the same side.

## Charts

Market pages show historical activity and volume over time. The chart helps you see how sentiment shifted, not to predict the final result.

## Virtual liquidity

New markets start with a small amount of **virtual liquidity** spread across outcomes so prices are not extreme before anyone trades. Creator **seed liquidity** (real collateral) further shapes opening odds. See [Seed liquidity](../creating-markets/seed-liquidity.md).

## Multi-outcome markets

With three or more options, each outcome has its own pool weight. Probabilities across all options should sum to roughly 100%. Selecting one outcome in the trade panel shows that outcome’s price and order book.

## Limit order prices

Limit orders use a **price you specify** in collateral per share (or equivalent units shown in the UI). They do not change the pool probability until a market trade occurs on the other side of a match.

## What probability is not

- Not a forecast from Mondalore — it is crowd-priced.
- Not fixed — it updates with every pool trade.
- Not what you will necessarily receive at settlement — losers receive nothing; winners split the redeemable pool per share mechanics.

[Fees & slippage →](fees-and-slippage.md)

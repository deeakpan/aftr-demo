# Price markets

Price markets settle automatically from an **official asset price** at resolve time — no manual outcome vote.

## What to prepare

### Asset

Select the asset whose price determines the outcome (major crypto assets and others supported in the create flow).

### Direction

| Kind | Question shape |
|------|----------------|
| **Above** | Price at or above a threshold → Yes; otherwise No |
| **Below** | Price at or below a threshold → Yes; otherwise No |
| **In range** | Price falls between bounds → specific outcomes per bucket |

### Threshold

Set the price level (or range boundaries) that define winning outcomes. Use the same units and precision traders expect for that asset.

### Schedule

| Field | Meaning |
|-------|---------|
| **Stake ends** | Last pool trades accepted |
| **Resolve after** | Moment the price snapshot is taken for settlement |

Align **resolve after** with the exact time your question references (e.g. “Friday 16:00 UTC close”).

### Outcomes

Binary price markets are usually Yes/No relative to the threshold. Multi-bucket markets split price ranges across named outcomes.

## How traders read your market

The detail page shows the asset, threshold, direction, and resolve time. Traders do not need external context beyond what you configure.

## Settlement

After **resolve after**, the winning outcome is determined by comparing the official price to your rule. Settlement is fast and does not wait on admin signatures.

## When to use price markets

- Macro crypto levels (“BTC above X”)
- Token launch price targets
- Any question answerable purely from a price feed at a timestamp

## When not to use price markets

- Questions about events, people, or policies with no price definition
- Subjective “sentiment” questions

Use [Event markets](event-markets.md) instead.

[Seed liquidity →](seed-liquidity.md)

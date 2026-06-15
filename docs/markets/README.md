# Markets

Every Mondalore market is a self-contained question with defined outcomes, trading windows, and settlement rules. Understanding how markets are structured helps you trade and create with confidence.

## The core question

Each market asks something answerable at a known time:

- “Will candidate X win the election?”
- “Will BTC be above $100k at noon UTC on Friday?”
- “Which team wins the finals?”

Creators write the title, description, outcomes, and timing. Traders decide which outcome they believe will win.

## Shared properties

All markets have:

- **Collateral** — USDC or MON
- **Outcomes** — two or more mutually exclusive results
- **Stake end** — last moment new pool trades are accepted
- **Resolve after** — earliest time settlement can occur
- **Pool** — collateral backing outcome shares

## Two market families

| | Event markets | Price markets |
|---|---------------|---------------|
| **Settles from** | Real-world / official event result | Asset price at resolve time |
| **Creator provides** | Resolution sources (public URLs) | Asset, threshold, direction |
| **Settlement** | Community admin review | Automated price check |

Details: [Market types](market-types.md).

## Guides

- [Market types](market-types.md)
- [Market lifecycle](market-lifecycle.md)
- [How settlement works](how-settlement-works.md)

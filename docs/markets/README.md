# Markets

Every Zedkr market is a self-contained question with defined outcomes, trading windows, and settlement rules. Understanding how markets are structured helps you trade and create with confidence.

## The core question

Each market asks something answerable at a known time:

- “Will candidate X win the election?”
- “Will BTC be above $100k at noon UTC on Friday?”
- “Which token has the highest market cap by resolve?”
- “Will this Prism RWA’s APY stay above X%?”

Creators write the title, description, outcomes, and timing. Traders decide which outcome they believe will win.

## Shared properties

All markets have:

- **Collateral** - USDC or another supported token
- **Outcomes** - two or more mutually exclusive results
- **Stake end** - last moment new pool trades are accepted
- **Resolve after** - earliest time settlement can occur
- **Pool** - collateral backing outcome shares

## Four market families

| | Event | Price | Token | RWA (Prism) |
|---|-------|-------|-------|-------------|
| **Settles from** | Real-world result | Oracle asset price | DEX pair stats | [Prism](https://prismassets.shop) catalogue |
| **Creator provides** | Resolution source URLs | Asset, threshold, direction | Pool links + question | Prism assets + question |
| **Settlement** | Admin review | Automated | Automated | Automated |

Details: [Market types](market-types.md).

## Guides

- [Market types](market-types.md)
- [Market lifecycle](market-lifecycle.md)
- [How settlement works](how-settlement-works.md)

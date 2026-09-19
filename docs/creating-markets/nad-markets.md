# Nad markets (legacy)

> **Not in Create.** New markets use **[Token markets](token-markets.md)** (DEX pool links) or **[RWA (Prism)](rwa-prism-markets.md)**. This page describes older **Nad.fun**-backed markets that may still exist on-chain.

**Nad markets** resolved from live stats on tokens from **[Nad.fun](https://nad.fun)** — Monad’s bonding-curve launchpad. Traders bet on live token stats; settlement read Nad.fun at resolve time.

## What they were for

Questions about **Nad.fun token metrics**:

- Market cap, price, or holder thresholds
- Head-to-head highest market cap
- First-to-mcap races

## Settlement

Settlement did not use admin votes. Metadata pointed at Nad.fun API endpoints; a resolver bot fetched the snapshot at **resolve after** and settled on-chain.

## Prefer instead

| Need | Use |
|------|-----|
| DEX token price / mcap | [Token markets](token-markets.md) |
| Tokenized RWA / yield on Prism | [RWA (Prism) markets](rwa-prism-markets.md) |
| Oracle BTC/ETH price | [Price markets](price-markets.md) |

## Related

- [Market types](../markets/market-types.md)
- [How settlement works](../markets/how-settlement-works.md)

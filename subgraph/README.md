# AFTR subgraph (The Graph)

Indexes on Base Sepolia:

- **`MarketCreated`** on the factory — creates a `Market` row and a **dynamic `Market` template** per market.
- **`Deposited`** / **`TokensRedeemed`** on each market — maintains:
  - **`MarketTrade`** — per-event rows for trade activity charts (`marketTrades` query).
  - **`Trader`** — `totalDeposited` / `totalRedeemed` (leaderboard).
  - **`TraderMarketPosition`** — per `(market, trader)` aggregates.
- **Vault** events — staking / fee epochs.

Router trades are included because the router calls `market.deposit` / redeem, which emits the same market events.

## Before you deploy

1. **`subgraph.yaml` → `startBlock`** on Factory and Vault must match `deployments/baseSepolia-84532.json` (`npm run subgraph:update-config` from repo root).
2. **`source.address`** must match deployed factory and vault.

## Commands (repo root)

```bash
npm run subgraph:update-config
npm run subgraph:codegen
npm run subgraph:build
SUBGRAPH_VERSION_LABEL=v0.08 npm run subgraph:deploy-studio
```

Set `SUBGRAPH_DEPLOY_KEY` in `.env`. After sync, point the app at:

`https://api.studio.thegraph.com/query/1749057/aftr/v0.08`

## Trade activity chart query

```graphql
query MarketTrades($market: String!) {
  marketTrades(
    where: { market: $market }
    orderBy: timestamp
    orderDirection: asc
    first: 1000
  ) {
    id
    timestamp
    collateralAmount
    outcomeIndex
    kind
  }
}
```

(`$market` = lowercased market address.)

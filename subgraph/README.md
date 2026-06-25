# Mondalore subgraph (The Graph)

Indexes on **Monad testnet** (chainId 10143):

- **`MarketCreated`** on the factory — creates a `Market` row (`kind`: 0=PRICE, 1=EVENT, 2=NAD_TOKEN) and a **dynamic `Market` template** per market.
- **`Deposited`** / **`TokensRedeemed`** on each market — maintains:
  - **`MarketTrade`** — per-event rows for trade activity charts (`marketTrades` query).
  - **`Trader`** — `totalDeposited` / `totalRedeemed` (leaderboard).
  - **`TraderMarketPosition`** — per `(market, trader)` aggregates.
- **Vault** events — staking / fee epochs.

Router trades are included because the router calls `market.deposit` / redeem, which emits the same market events.

## Before you deploy

1. Deploy stack → `deployments/monadTestnet-10143.json` must be current.
2. Run **`npm run subgraph:update-config`** — patches `subgraph.yaml` addresses + `startBlock` from that JSON.
3. Refresh ABIs after contract changes (from `artifacts/…/Mondalore*.json` → `subgraph/abis/`).

## Commands (repo root)

```bash
npm run subgraph:update-config
npm run subgraph:codegen
npm run subgraph:build
STUDIO_SUBGRAPH_SLUG=mondalore-testnet SUBGRAPH_VERSION_LABEL=v0.01 npm run subgraph:deploy-studio
```

Set `SUBGRAPH_DEPLOY_KEY` in `.env`. After sync, point the app at:

`https://api.studio.thegraph.com/query/1749057/mondalore-testnet/v0.01`

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

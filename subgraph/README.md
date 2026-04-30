# AFTR subgraph (The Graph)

Indexes **`MarketCreated`** on the factory (creates a `Market` row + **dynamic data source** per market), then on each market contract indexes **`Deposited`** and **`TokensRedeemed`** to maintain:

- **`Trader`** — `totalDeposited` / `totalRedeemed` (wallet-level leaderboard inputs).
- **`TraderMarketPosition`** — `collateralIn` / `collateralOut` / `sharesIn` / `sharesOut` per `(market, trader)`; deposits use **`recipient`**, redemptions use **`user`**.

## Before you deploy

1. **`subgraph.yaml` → `startBlock`**  
   Set to the **block where the factory contract was deployed** (not `23600000` unless that is correct). Wrong `startBlock` = missed markets or slow backfill.

2. **`subgraph.yaml` → `source.address`**  
   Must match your `AFTRParimutuelMarketFactory` on Base Sepolia.

3. **`TokensRedeemed`**  
   Only exists on market bytecode that **emits** it; older markets still get **deposits** indexed.

## Commands

```bash
npm install --prefix subgraph
npm run codegen --prefix subgraph
npm run build --prefix subgraph
```

From repo root you can use **`npm run subgraph:codegen`** / **`npm run subgraph:build`** (see root `package.json`).

## Deploy (hosted)

Create a subgraph in [Subgraph Studio](https://thegraph.com/studio), then:

```bash
cd subgraph
npx graph auth --studio <DEPLOY_KEY>
npx graph deploy --studio <SUBGRAPH_SLUG>
```

You get a **GraphQL endpoint**; your Next app queries it (no need to run `graph-node` yourself).

## Example: leaderboard-style query

```graphql
query TopTraders {
  traders(
    first: 50
    orderBy: totalDeposited
    orderDirection: desc
  ) {
    id
    totalDeposited
    totalRedeemed
  }
}
```

Filter one wallet:

```graphql
query OneTrader($id: ID!) {
  trader(id: $id) {
    id
    totalDeposited
    totalRedeemed
    positions {
      market { id }
      collateralIn
      collateralOut
    }
  }
}
```

(`$id` = lowercased `0x…` address.)

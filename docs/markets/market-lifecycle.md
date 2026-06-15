# Market lifecycle

Every market moves through predictable stages. Two dates matter most: **stake end** and **resolve after**.

## Timeline overview

```
Created → Open for trading → Stake end (trading closes) → Resolve after → Settled → Winners claim
```

## 1. Creation

A creator launches the market, sets outcomes and times, and optionally **seeds liquidity** to establish opening odds. The market appears on the Markets page.

## 2. Open

While **open** and before **stake end**:

- Traders can place **market buys** (pool deposits)
- Traders can place **limit orders** (buy and sell)
- Probabilities update with activity

This is the main window for building a position.

## 3. Stake end

At **stake end**:

- **New pool deposits stop** — you cannot market-buy into the pool after this timestamp
- Existing share holders still own their positions
- Limit orders may still operate depending on market rules and timing

If you planned to enter via a market trade, do so **before stake end**.

## 4. Resolve after

**Resolve after** is the earliest moment settlement can happen. It gives the real world (or price feed) time to produce a definitive answer after trading closes.

Between stake end and resolve after:

- The outcome may already be known in the news, but the market is not settled yet on-chain
- You still cannot claim until settlement completes

## 5. Settlement

Settlement locks in the **winning outcome index**.

- **Price markets:** triggered after resolve after using the configured price check
- **Event markets:** triggered after enough resolution admins sign the same outcome

After settlement, the market state is **Settled**.

## 6. Redemption

Winners redeem shares for collateral on the **Trades** page. Losers need take no action.

## Breaking filter

Markets appearing under **Breaking** are those with **resolve after** within the next 24 hours — useful if you want action nearing finalization.

## Creator vs trader view

| Milestone | Trader cares because… | Creator cares because… |
|-----------|----------------------|------------------------|
| Stake end | Last chance to market-buy | Trading volume stops accruing pool fees |
| Resolve after | Settlement incoming | Resolution accuracy matters for reputation |
| Settled | Claim or move on | Creator fees already earned from trades |

[How settlement works →](how-settlement-works.md) · [Timelines reference](../reference/timelines.md)

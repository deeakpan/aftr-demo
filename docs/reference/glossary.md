# Glossary

## Collateral

The token used in a market - typically **USDC** (or another supported token such as **USDG**). All trades and payouts in that market use this token.

## Outcome

One possible result of a market question. Binary markets have two outcomes; multi-outcome markets have three or more.

## Outcome share

A token representing your position on one outcome. If that outcome wins at settlement, shares can be redeemed for collateral. Also called outcome tokens.

## Probability (implied)

The percentage shown for each outcome based on current pool weights. Reflects crowd pricing, not a guaranteed forecast.

## FPMM pool

A shared pool of collateral split across outcomes. New buys mint shares based on current weights; winners redeem from the settled pool.

## Market trade

An immediate pool buy - you deposit collateral and receive shares at the current pool price.

## Limit order

An order to buy or sell shares at a price you set. Fills when matched; may rest on the order book until filled or cancelled.

## Order book

List of open limit buy and sell orders for an outcome.

## Stake end

Timestamp when new **market trades** (pool deposits) stop. After this, you cannot market-buy into the pool.

## Resolve after

Earliest timestamp when a market can **settle**. Should be after the real-world result or price snapshot is available.

## Settlement

Finalizing the winning outcome on-chain. Enables winners to claim collateral.

## Redeem / claim

Burning winning outcome shares to receive collateral after settlement.

## Event market

Market settled by verifying a real-world result against **resolution sources** with protocol admins.

## Price market

Market settled automatically by comparing an official asset price to a configured rule at resolve time.

## Token market

Market on DEX tokens via Dexscreener / GeckoTerminal pool links - settled automatically from pair stats (price or market cap) at resolve time. See [Token markets](../creating-markets/token-markets.md).

## RWA (Prism) market

Market on [Prism](https://prismassets.shop) catalogue assets - settled automatically from Prism data (price, market cap, or APY) at resolve time. See [RWA (Prism) markets](../creating-markets/rwa-prism-markets.md).

## Resolution sources

Public HTTPS links provided by the creator where the official event result will be published.

## Resolution admins

Independent reviewers who sign event market outcomes after checking resolution sources.

## Seed liquidity

Initial collateral a creator deposits when launching a market to establish opening odds.

## Virtual reserve

Small built-in liquidity weight spread across outcomes so new markets are not priced at 0% / 100% before anyone trades.

## Slippage

Tolerance for pool price movement between quote and execution. Protects against unexpectedly few shares.

## Creator fee

0.25% of each pool trade paid to the market creator (one quarter of the **1%** trade fee).

## Protocol fee

0.75% of each pool trade split across platform, distribution, and treasury shares.

## Vol

Trading volume shown on market cards. (Pool size / TVL is not shown on cards.)

## Binary market

Two-outcome market (typically Yes/No).

## Multi-outcome market

Market with three or more named outcomes.

## Gas

Network fee paid to process any transaction. Separate from Zedkr trading fees.

## Para / wallet

Your account is a **Para** embedded wallet (email, phone, or social sign-in). The address is used to trade and claim on Zedkr - MetaMask is not required for session identity.

## Display name

Optional nickname shown in the app; does not replace your wallet address on-chain.

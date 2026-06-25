# Glossary

## Collateral

The token used in a market — **USDC** or **MON**. All trades and payouts in that market use this token.

## Outcome

One possible result of a market question. Binary markets have two outcomes; multi-outcome markets have three or more.

## Outcome share

A token representing your position on one outcome. If that outcome wins at settlement, shares can be redeemed for collateral. Also called outcome tokens.

## Probability (implied)

The percentage shown for each outcome based on current pool weights. Reflects crowd pricing, not a guaranteed forecast.

## Parimutuel pool

A shared pool of collateral split across outcomes. New buys mint shares based on current weights; winners redeem from the settled pool.

## Market trade

An immediate pool buy — you deposit collateral and receive shares at the current pool price.

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

Market settled by verifying a real-world result against **resolution sources** with admin signatures.

## Price market

Market settled automatically by comparing an official asset price to a configured rule at resolve time.

## Nad market

Market on [Nad.fun](https://nad.fun) tokens — settled automatically from Nad.fun API data (market cap, price, or holders) at resolve time. See [Nad markets](../creating-markets/nad-markets.md).

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

0.3% of each pool trade paid to the market creator.

## Protocol fee

1.2% of each pool trade paid to the protocol (partly shared with MONDO stakers).

## MONDO / sMONDO

MONDO is the staking token. sMONDO is the non-transferable receipt received when you stake MONDO 1:1.

## TVL (pool size)

Total value of collateral locked in a market’s pool.

## Binary market

Two-outcome market (typically Yes/No).

## Multi-outcome market

Market with three or more named outcomes.

## Gas

Network fee paid to process any transaction. Separate from Mondalore trading fees.

## Wallet

Your crypto account (address) used to connect, trade, and claim on Mondalore.

## Display name

Optional nickname shown in the app; does not replace your wallet address on-chain.

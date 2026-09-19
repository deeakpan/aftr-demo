# Token markets

**Token markets** settle from live DEX pool stats for tokens you pick via a **Dexscreener** or **GeckoTerminal** pool link. Traders bet on price or market cap; a resolver bot reads the pair at **resolve after**.

## When to use a token market

Create a token market when the question is about **traded token metrics** on a public pool:

- Token **USD price** above a threshold
- **Market cap** above a threshold
- **Head-to-head** — which token has the highest price or market cap at resolve

Use **RWA (Prism)** instead for tokenized real-world assets on [Prism](https://prismassets.shop). Use **Price (oracle)** for Chainlink-style assets (ETH, BTC, gold feeds).

## Setup flow

1. Open **Create** and choose **Token market**.
2. Pick a **question type** (threshold or comparison).
3. Paste one or more **Dexscreener / GeckoTerminal pool URLs** and confirm the token loads.
4. Set thresholds (if required), **stake end**, and **resolve after**.
5. Seed liquidity and submit.

## Question shapes

| Style | What you’re betting on |
|-------|------------------------|
| **Threshold** | Yes/No on one token — price or mcap above a USD target |
| **Comparison** | Two to four tokens — highest price or highest mcap at resolve |

## Resolution

Settlement is **automatic**. Market metadata stores the pool links and question rules; the resolver fetches pair stats at resolve time and settles on-chain. No admin vote.

On the market page, Zedkr shows live pair stats and a Dex chart when available, plus the shared **trades / chance** chart.

## Creator tips

- Prefer liquid pools so price/mcap at resolve is meaningful.
- Use clear tickers in the title (`$A` vs `$B` — highest mcap by …).
- Seed enough liquidity so opening odds aren’t extreme.

## Related

- [Market types](../markets/market-types.md#token-markets)
- [How settlement works](../markets/how-settlement-works.md#token-market-settlement)
- [RWA (Prism) markets](rwa-prism-markets.md)
- [Seed liquidity](seed-liquidity.md)

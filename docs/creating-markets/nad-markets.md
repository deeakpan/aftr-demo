# Nad markets

**Nad markets** let you create prediction markets on tokens from **[Nad.fun](https://nad.fun)** — Monad’s bonding-curve launchpad for meme tokens. Traders bet on live token stats; settlement reads Nad.fun at resolve time.

On Monad testnet, use [testnet.nad.fun](https://testnet.nad.fun) for the same flow.

## When to use a Nad market

Create a Nad market when the question is about **Nad.fun token metrics**, not a Chainlink asset or a generic real-world event:

- Market cap above a USD threshold
- Token price above a USD level
- Holder count above a number
- **Head-to-head** — which token has the highest market cap at resolve
- **Race** — which token hits a target market cap first

## Setup flow

1. Open **Create** and choose **Nad** as the market type.
2. Pick a **question template** (threshold or comparison).
3. Paste **token contract addresses** from Nad.fun — find them on each token’s page on [nad.fun](https://nad.fun).
4. Set **thresholds** (if required), **stake end**, and **resolve after**.
5. Seed liquidity and submit.

Duplicate Nad markets (same tokens + question type) are blocked to reduce spam.

## Tokens & parity rules

- **1 token** — binary Yes/No on mcap, price, or holders.
- **2–4 tokens** — comparison outcomes (one winner, or Neither when applicable).
- **First to mcap** races require tokens to start within **10% market cap** of the first listed token.
- **Highest mcap** comparisons need resolve at least **4 days** out so rankings have time to move.

## Resolution sources

Settlement does not use manual admin votes. The market metadata points at Nad.fun API endpoints; a resolver bot fetches the snapshot at **resolve after** and settles on-chain.

Traders should confirm token addresses on Nad.fun before trading — the ticker on the market card links back to the token page.

## Creator tips

- Use clear tickers in the title (“`$A` vs `$B` — highest mcap by …”).
- Pick resolve times **after** the bonding-curve / mcap story you care about has played out.
- Seed enough liquidity so opening odds aren’t extreme.

## Related

- [Market types — Nad markets](../markets/market-types.md#nad-markets-nadfun-tokens)
- [How settlement works](../markets/how-settlement-works.md#nad-market-settlement)
- [Seed liquidity](seed-liquidity.md)

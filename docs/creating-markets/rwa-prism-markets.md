# RWA (Prism) markets

**RWA (Prism)** markets settle from verified tokenized real-world assets listed on **[Prism](https://prismassets.shop)** — gold, treasuries, yield products, and similar catalogue assets. You pick assets from the Prism list in Create; settlement reads Prism at **resolve after**.

## When to use an RWA market

Create an RWA market when the question is about **Prism catalogue metrics**:

- Asset **USD price** above a threshold
- **Market cap** above a threshold
- **Yield (APY %)** above a threshold
- **Head-to-head** — highest price, market cap, or yield among 2–4 assets

Do **not** use Dexscreener pool links here — Prism assets are not Dex pairs. Use **Token market** for DEX tokens.

## Setup flow

1. Open **Create** and choose **RWA (Prism)**.
2. Pick a **question type** from the dropdown (Linear or Vs).
3. For each outcome, tap **Add asset** and select from the Prism catalogue (mobile: bottom sheet; desktop: dialog).
4. Set thresholds (if required), **stake end**, and **resolve after**.
5. Seed liquidity and submit.

## Question shapes

| Style | What you’re betting on |
|-------|------------------------|
| **Linear** | Yes/No on one asset — price, mcap, or APY above a target |
| **Vs** | Two to four assets — highest price, mcap, or yield at resolve |

## What traders see

- Market cards show a **Prism RWA** badge and live Prism price/mcap when available.
- Detail pages show asset stats from the **Prism API** and the **trades / chance** chart (no Dexscreener chart — Prism has no DEX pair embed).
- Resolution sources link to Prism asset and verify pages.

## Resolution

Settlement is **automatic**. Metadata stores Prism asset slugs and the question rule; the resolver fetches a Prism snapshot at resolve time and settles on-chain. No admin vote.

## Creator tips

- Prefer well-known catalogue assets (e.g. PAXG, XAUT, USDY) so traders recognize the underlyings.
- For yield questions, resolve after enough time for APY reporting to be meaningful.
- Seed enough liquidity for fair opening odds.

## Related

- [Market types](../markets/market-types.md#rwa-prism-markets)
- [How settlement works](../markets/how-settlement-works.md#rwa-prism-settlement)
- [Token markets](token-markets.md)
- [Seed liquidity](seed-liquidity.md)

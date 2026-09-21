# How settlement works

Settlement is when a market picks a winning outcome so winners can claim. Until then, your shares are still open positions.

## After settlement

- One outcome is marked the **winner**
- Winning shares can be claimed for collateral
- Losing shares are worth nothing
- Pool trading on that market stops

## Who decides the winner?

It depends on the market type.

### Event markets (admin review)

Event markets are about real-world results (elections, sports, announcements).

1. Trading closes at **stake end**. Settlement can start after **resolve after**.
2. Protocol **admins** check the **resolution sources** the creator listed (official sites, results pages, and similar public links).
3. More than one admin must agree on the same winner.
4. When enough admins agree, the market settles and winners can claim.

**What you should know as a trader**

- The creator does **not** settle the market alone.
- Read the description and open every resolution source before you trade.
- If the question is vague or sources are weak, settlement can be slow or contested. Size your trade accordingly.
- Importing a Polymarket template does **not** mean Polymarket settles the Zedkr market. Admins still decide from the listed sources.

**What creators should know**

- Only create event markets when a clear public record will exist.
- Add solid resolution source links. Weak or missing sources stall settlement.

### Price markets

After **resolve after**, the market uses the configured asset price rule (above, below, or range). No admin vote. Anyone can finish settlement once the time and price rule are met.

### Token markets

After **resolve after**, the market uses live DEX pool stats from the Dexscreener or GeckoTerminal links on the market. No admin vote.

### RWA (Prism) markets

After **resolve after**, the market uses Prism catalogue stats (price, market cap, or APY, depending on the question). No admin vote.

## Claiming

After settlement, go to **Trades**, open the market, and claim if you hold the winning outcome. Payout depends on how many winning shares you hold and how the pool was filled. It is not a fixed $1 per share.

## Can the result be wrong?

- **Price, token, and RWA:** the published rule and data source at resolve time decide. Read the market text carefully.
- **Event:** admins follow the resolution sources. Contested real-world events still carry risk.

## What if nobody presses settle?

For automated types (price, token, RWA), anyone can trigger settlement once conditions are met. Event markets wait on admin agreement. Neither requires the original creator or traders to be the ones who finalize.

## Related

- [Claiming winnings](../positions/claiming-winnings.md)
- [Event markets](../creating-markets/event-markets.md)
- [Token markets](../creating-markets/token-markets.md)
- [RWA (Prism) markets](../creating-markets/rwa-prism-markets.md)
- [FAQ](../reference/faq.md)

# Creating markets

Anyone can launch a market on Zedkr. Creators define the question, outcomes, schedule, and initial liquidity. As traders participate, creators earn a share of trading fees.

## Why create a market?

- Surface questions your community cares about
- Bootstrap liquidity around an event or price level
- Earn **0.25%** of every pool trade on your market (one quarter of the **1%** trade fee)

## Creation flow (overview)

1. **Details** — title, description, image, category, market type  
   (Event markets: optional **Import from Polymarket** to prefill from a Polymarket URL)
2. **Outcomes** — Yes/No, custom binary labels, multiple options, or type-specific asset pickers (Token / RWA)
3. **Schedule** — stake end and resolve after (local time converted to UTC)
4. **Seed liquidity** — optional but recommended initial collateral
5. **Submit** — confirm with Para; market goes live

## Market type choice

| Type | Choose when… |
|------|----------------|
| **Event** | Result comes from the real world (elections, sports, announcements) |
| **Price** | Result comes from an oracle asset price at resolve time |
| **Token market** | Result comes from DEX pool stats (Dexscreener / GeckoTerminal links) |
| **RWA (Prism)** | Result comes from [Prism](https://prismassets.shop) catalogue assets (price, mcap, APY) |

See [Event markets](event-markets.md), [Price markets](price-markets.md), [Token markets](token-markets.md), and [RWA (Prism) markets](rwa-prism-markets.md).

## Permissions

Market creation is **permissionless** — no allowlist application. You need:

- Signed in with **Para** on the correct network
- Enough collateral for seed liquidity (if seeding)
- Gas for the creation transaction

The **minimum seed** (and creation gas) is intentional: it makes spamming duplicate markets costly and encourages creators to put real collateral behind markets they want traders to take seriously. See [Seed liquidity](seed-liquidity.md).

## Creator responsibilities

- Write a **clear, unambiguous** question
- Set realistic **stake end** and **resolve after** times
- For event markets, provide **valid resolution source URLs**
- For token / RWA markets, pick the correct pools or Prism assets
- Seed enough liquidity for reasonable opening odds

Poorly written markets are harder to settle and attract fewer traders.

## Event markets: choose questions with public outcomes

Event markets only work well when the result can be checked against **open, authoritative records** — election commissions, league scoreboards, regulatory filings, official company announcements, and similar sources anyone can verify.

Avoid creating markets when:

- The outcome depends on private information or insider knowledge
- No reliable public source will publish a definitive answer
- The question is subjective (“best album”, “most influential”) without an official winner
- The event might be cancelled, postponed indefinitely, or never reported formally

If resolution admins cannot confirm a result from the links you provide, settlement stalls and traders lose confidence. When in doubt, pick a different question or ask the team before you publish.

## Get in touch on Telegram

Use the Zedkr Telegram community — [@zedkrcommunity](https://t.me/zedkrcommunity) — when you want help before or after creating a market. Useful situations include:

- Checking whether your event idea has strong enough public data for settlement
- Reviewing wording, outcomes, or resolution sources for edge cases
- Reporting a stuck or disputed settlement
- Partnerships, featured markets, or other non-standard requests
- Questions about which network or deployment you should be on

The team can steer you early and save a bad market from going live.

## Network & contract addresses

Confirm you are on the correct chain before creating. See [Deployments](../reference/deployments.md) for network names, chain IDs, and core contract addresses.

## Guides

- [Event markets](event-markets.md)
- [Price markets](price-markets.md)
- [Token markets](token-markets.md)
- [RWA (Prism) markets](rwa-prism-markets.md)
- [Seed liquidity](seed-liquidity.md)

## Fees you earn

Each pool trade on your market pays you **0.25%** of the traded amount automatically (creator share of the **1%** fee). You do not need to claim creator fees separately in most cases — they are sent to your address on each trade.

Full fee table: [Reference — Fees](../reference/fees.md).

# Event markets

Event markets resolve from **real-world outcomes** verified against public sources. Only launch this type when the answer will be **publicly documented** somewhere trustworthy.

## The public-data rule

Before you create an event market, ask: *Will an independent reviewer be able to verify the winner from URLs anyone can open?*

Good fits:

- Elections with official government or commission results pages
- Sports with published final scores on a league or tournament site
- Corporate events with dated press releases or SEC-style filings
- On-chain or market milestones with a defined, published metric

Poor fits:

- Gossip, rumors, or “everyone knows” outcomes
- Questions that rely on paywalled or disappearing pages as the only source
- Scenarios where the event may not produce any official record

Markets without verifiable public data are slow to settle, frustrate traders, and hurt creator reputation. If you are not sure your event clears this bar, message [@mondalorecommunity](https://t.me/mondalorecommunity) on Telegram before submitting.

## What to prepare

### Title and description

State the question precisely. Include:

- What exactly is being measured
- Any edge cases (postponement, runoff elections, overtime rules)
- What counts as “official” for your question

Vague wording leads to settlement disputes.

### Outcomes

**Binary** — two options (default Yes/No or custom labels like “Team A” / “Team B”).

**Multi-outcome** — three or more named options. Every realistic winner should be listed, plus an explicit catch-all if needed (e.g. “Other”).

### Resolution sources (required)

Add at least one **HTTPS URL** where the official result will appear:

- Government election portals
- League or tournament official results
- Company investor relations or press releases
- Recognized news wires only if they are the defined primary source

Optional **labels** help traders understand each link (“Official results”, “FEC filing”, etc.).

Resolution admins use these links when signing the outcome. Without credible, **publicly accessible** sources, settlement may be delayed or contested.

Prefer primary sources (the organization running the event) over blogs or social posts. Add multiple links when possible so reviewers can cross-check.

### Schedule

| Field | Meaning |
|-------|---------|
| **Stake ends** | Last moment traders can market-buy into the pool |
| **Resolve after** | Earliest settlement time — should be after the real-world result is expected |

Leave buffer after the event for official results to publish.

## Settlement model

Event markets use **community resolution admins** — a fixed panel who independently review evidence and sign the winning outcome. Settlement requires multiple matching signatures, not one person’s call.

Traders see resolution sources on the market page. Read them before trading.

## Categories

Tag your market (Crypto, Politics, Finance, Tech, Economy, Sports, Gaming, Entertainment, Culture) so the right audience finds it.

## After launch

- Share the market link
- Monitor trading and clarify description if questions arise in community channels
- Creator fees accrue automatically on each trade
- If results are unclear or settlement is taking longer than expected, reach out on [@mondalorecommunity](https://t.me/mondalorecommunity) with the market link and your resolution sources

[Seed liquidity →](seed-liquidity.md) · [How settlement works](../markets/how-settlement-works.md) · [Deployments](../reference/deployments.md)

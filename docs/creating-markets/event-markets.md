# Event markets

Event markets resolve from **real-world outcomes** verified against public sources. Only launch this type when the answer will be **publicly documented** somewhere trustworthy.

## Import from Polymarket (optional)

On Create → **Event**, you can tap **Import from Polymarket** and paste a Polymarket event or market URL (for example `https://polymarket.com/event/…`).

Mondalore pulls what it can from Polymarket’s public catalog and prefills your form:

| Field | What we import |
|-------|----------------|
| **Title & description** | Event / market question text and rules |
| **Cover image** | Polymarket cover (downloaded into your create flow) |
| **Outcomes** | Binary Yes/No for a single market, or multi-option labels when the event has several child markets |
| **Resolution source** | The Polymarket link itself (you should still add primary official sources) |
| **Resolve after** | Polymarket’s end date |
| **Stake ends** | Derived (~24h before resolve) — Polymarket has no stake-end field |
| **Slug** | Suggested from the Polymarket slug |

After import, review everything. Adjust wording, outcomes, sources, and times before you seed and submit. Import is a **template only** — the Mondalore market is separate and is **resolved through protocol admins**, not Polymarket’s own resolution.

Tips:

- Multi-child Polymarket events (e.g. “next team” with many options) become a **multi-outcome** Mondalore market using those option labels as listed
- We do **not** invent an “Other” option — only keep a catch-all if Polymarket already has one
- Always confirm stake end / resolve after still make sense for when official results will publish

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

Event markets are **resolved through protocol admins** — reviewers who check your resolution sources and confirm the winning outcome. Settlement is not automatic from a price feed.

Traders see resolution sources on the market page. Read them before trading.

## Categories

Tag your market (Crypto, Politics, Finance, Tech, Economy, Sports, Gaming, Entertainment, Culture) so the right audience finds it.

## After launch

- Share the market link
- Monitor trading and clarify description if questions arise in community channels
- Creator fees accrue automatically on each trade
- If results are unclear or settlement is taking longer than expected, reach out on [@mondalorecommunity](https://t.me/mondalorecommunity) with the market link and your resolution sources

[Seed liquidity →](seed-liquidity.md) · [How settlement works](../markets/how-settlement-works.md) · [Deployments](../reference/deployments.md)

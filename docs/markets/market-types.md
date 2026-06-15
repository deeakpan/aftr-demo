# Market types

Mondalore supports two kinds of markets. The trading experience is the same; settlement differs.

## Event markets

**Event markets** resolve based on what actually happened in the real world.

Examples:

- Election winner
- Sports match result
- Product launch date met or missed
- Award show outcome

### Resolution sources

Creators must attach at least one **resolution source** — a public HTTPS link where the official result will be published (election commission, league site, company press release, etc.). These links guide independent reviewers when the market settles.

### Settlement

After **resolve after**, a panel of **factory resolution admins** reviews evidence against the resolution sources and signs off on the winning outcome. Settlement requires multiple independent signatures agreeing on the same result — not a single person’s decision.

If you trade event markets, read the description and resolution sources before entering. Your payout depends on admins confirming the outcome that matches those sources.

## Price markets

**Price markets** resolve from an **official asset price** at the resolve time.

Examples:

- “Will ETH be above $4,000 at resolve?”
- “Will gold close below $2,100 in the window?”

### Configuration

The creator selects:

- **Asset** — which price feed to use
- **Direction** — above, below, or in a range
- **Threshold(s)** — the price level(s) that define each outcome

### Settlement

Once **resolve after** passes, settlement reads the price feed and determines the winning outcome automatically. No manual admin vote is required for the outcome selection.

## Binary vs multi-outcome

Either market type can be:

- **Binary** — two outcomes (Yes/No or custom labels)
- **Multi-outcome** — three or more named options

Price markets can use multiple buckets (e.g. price ranges). Event markets can list every candidate or team.

## Which type should I trade?

| Prefer event markets when… | Prefer price markets when… |
|----------------------------|----------------------------|
| The question is about news, sports, politics | The question is purely about an asset price |
| You trust published resolution sources | You want fast automated settlement |
| You accept human review delay | You want rule-based outcomes |

[Market lifecycle →](market-lifecycle.md)

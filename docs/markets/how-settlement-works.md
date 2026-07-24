# How settlement works

Settlement is the moment a market picks a single winning outcome and enables redemption. Until then, shares are bets in flux.

## After settlement

- One outcome is marked **winner**
- Winning shares become redeemable for collateral
- Losing shares have zero value
- No further trading on the pool

## Price market settlement

1. **Resolve after** time passes.
2. The system reads the configured **official price** for the asset.
3. The outcome that matches the price rule (above/below/range) wins.
4. Anyone can trigger finalization once conditions are met; the market updates to settled within seconds.

Price markets do not rely on human judgment for the outcome — the rule and the price at resolve time decide.

## Nad market settlement

1. **Resolve after** time passes.
2. The resolver fetches a **snapshot from the Nad.fun API** for each token in the market (market cap, USD price, or holder count — depending on the question type).
3. The outcome that matches the rule (threshold met, highest mcap, first to target, etc.) wins.
4. Settlement finalizes on-chain automatically — no admin signatures.

Token contract addresses and question rules are stored in market metadata. Traders can verify tokens on [nad.fun](https://nad.fun) before entering a position.

## Event market settlement

1. **Resolve after** time passes.
2. **Protocol admins** review **resolution sources** the creator listed (official websites, results pages, etc.).
3. Admins confirm which outcome won.
4. Once enough admins agree, settlement finalizes on-chain.
5. Winners can claim.

Event markets are **resolved through protocol admins** using the creator’s public sources — not a price oracle and not Polymarket’s own settlement (even if you imported a Polymarket template).

### What traders should do

Before trading an event market:

- Read the market description carefully
- Open each **resolution source** link and understand what “official” means for this question
- Be comfortable that admins can verify the result from those sources

Ambiguous questions or missing sources increase dispute risk.

## Redemption mechanics

Winners submit a **claim** that burns winning shares and returns collateral. The per-share value is determined at settlement based on the pool — not a fixed $1 per share.

Parimutuel math means:

- Winners split the redeemable collateral pool
- Your payout scales with how many winning shares you hold relative to other winners

## Can settlement be wrong?

- **Price markets:** Outcome follows the configured rule and price feed at resolve time. If the feed is delayed or the rule ambiguous, edge cases are possible — read the market text.
- **Event markets:** Admins aim to match resolution sources. Contested real-world events carry inherent risk. Trade size accordingly.

## What if nobody settles?

Settlement can be triggered by any participant once conditions are met. Markets do not require the creator or original traders to finalize.

## Related

- [Claiming winnings](../positions/claiming-winnings.md)
- [Event markets](../creating-markets/event-markets.md)
- [FAQ](../reference/faq.md)

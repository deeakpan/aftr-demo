# Seed liquidity

When you create a market, you can deposit **seed liquidity** — an initial amount of collateral split across outcomes. This shapes opening odds and makes the market more attractive to the first traders.

## Why seed?

Empty pools produce extreme or meaningless probabilities. A seed:

- Establishes credible starting prices
- Signals skin in the game from the creator
- Helps the first traders get reasonable fills

## How it works

1. After filling market details, you proceed to the **seed** step.
2. Enter an amount in the market’s collateral (USDC or MON).
3. The creation flow splits seed across outcomes according to protocol rules (including virtual reserve and outcome count).
4. You receive **outcome shares** for your seeded sides — you are the first trader.

## Minimum seed

The app enforces a **minimum seed amount** (higher for MON-denominated markets on test deployments). Below the minimum, creation is blocked.

## Choosing seed size

| Larger seed | Smaller seed |
|-------------|--------------|
| Smoother opening odds | Less capital at risk |
| More serious signal to traders | Cheaper to experiment |
| You hold more initial shares | Pool moves faster with first outsiders |

There is no single right answer — match your conviction and audience size.

## What you receive

Seed collateral mints shares like any trade, including the **1.5% trade fee** on the seeded amount. You become a position holder on the outcome(s) your seed allocation favors.

If that outcome wins, you redeem like any other winner. If it loses, seeded collateral is part of the pool losers forfeit.

## Share recipient

By default shares go to your connected wallet. Advanced flows may designate another recipient — only change this if you intend to.

## One-time bootstrap

Seed happens **once at creation**. After the market is live, additional liquidity comes from ordinary traders, not a second creator seed step.

## Tips

- Seed the side you believe is **underpriced** if you want to offer value to contrarian traders — or balance evenly for neutral opening odds.
- Do not seed more than you can afford to lose.
- Pair seed size with a clear title and timeline.

[Creating markets overview →](README.md)

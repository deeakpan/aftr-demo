# Timelines & key dates

Every market has two timestamps creators set and traders must understand.

## Stake end

**What it is:** The last moment new **pool deposits** (market buys) are accepted.

**What happens at stake end:**

- Market trades into the pool stop
- You can no longer open a position via instant market buy after this time
- Existing share holders keep their positions

**Trader action:** Enter via market buy **before** stake end if that is your plan.

## Resolve after

**What it is:** The earliest time the market is allowed to **settle**.

**What happens at resolve after:**

- Price markets can read the official price and finalize
- Event markets can be signed by resolution admins and finalized
- Winners become eligible to claim after settlement completes (not necessarily the exact second of resolve after)

**Trader action:** Wait for settlement, then claim on the Trades page if you won.

## Typical ordering

```
Market created
    ↓
Trading open (before stake end)
    ↓
Stake end — pool buys close
    ↓
Waiting period (stake end → resolve after)
    ↓
Resolve after — settlement eligible
    ↓
Settled — winners claim
```

**Stake end** is always **before or equal to** resolve after in well-designed markets. Usually stake end is earlier so trading closes before the result is known.

## Example (election)

| Field | Example value | Reason |
|-------|---------------|--------|
| Stake end | Election day, 18:00 local | Stop trading when polls close |
| Resolve after | Election day + 2 days | Official results certified |

## Example (price)

| Field | Example value | Reason |
|-------|---------------|--------|
| Stake end | Friday 15:00 UTC | Stop bets before close |
| Resolve after | Friday 16:00 UTC | Price snapshot at market close |

## Breaking markets

The **Breaking** filter shows markets whose **resolve after** is within the next 24 hours — useful for last-minute position checks and claims.

## Time zones

The create flow accepts times in **your local timezone** and converts them for on-chain storage. Double-check displayed UTC or local labels before confirming creation.

## Limit orders after stake end

Pool market buys respect stake end strictly. Limit order behavior may depend on market state — if unsure, assume you should complete important entries before stake end.

[Market lifecycle →](../markets/market-lifecycle.md)

# Positions

A **position** is your holding of outcome shares in a specific market. Positions are tied to your wallet — if you disconnect and reconnect with the same wallet, your shares are still there.

## Where to view positions

The **Trades** page is your portfolio view. It lists every market where you hold shares (or where you have claimed/settled activity).

Each entry shows:

- Market title and type (Event or Price)
- Outcomes you hold and share balances
- Current implied probability
- Market state (open, closed, settled)
- **Claim** button when applicable

You can also see per-outcome balances on individual market pages.

## Position lifecycle

1. **Open** — you bought shares; market still accepting new pool trades (before stake end).
2. **Closed** — stake period ended; you still hold shares until settlement.
3. **Settled** — winning outcome decided.
4. **Claimed** — you redeemed winning shares for collateral.

## Winning vs losing

| Your outcome | After settlement |
|--------------|------------------|
| **Wins** | Redeem shares for collateral payout |
| **Loses** | Shares are worthless; nothing to claim |

You only need to act after settlement if you **won**. Losing positions simply show zero claimable value.

## Exiting early

You do not have to wait until settlement. Sell shares on the **limit order book** if you want to exit while the market is still active. See [Market vs limit orders](../trading/market-vs-limit-orders.md).

## Guides

- [Tracking your positions](tracking-positions.md)
- [Claiming winnings](claiming-winnings.md)

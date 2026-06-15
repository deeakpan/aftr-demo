# Claiming winnings

After a market **settles**, holders of the **winning outcome shares** can redeem them for collateral. This is called **claiming** (or redeeming) winnings.

## When you can claim

1. The market must be **settled** — the winning outcome has been finalized.
2. You must hold **winning outcome shares** with a balance greater than zero.
3. Your wallet must be connected on the correct network.

You cannot claim before settlement, even if the real-world result seems obvious.

## How to claim

1. Go to the **Trades** page.
2. Find the settled market where you won.
3. Review the estimated payout.
4. Click **Claim Winnings**.
5. Approve any token permission if prompted (outcome shares must be allowed to redeem).
6. Confirm the claim transaction in your wallet.

After confirmation, collateral arrives in your wallet and your winning share balance drops to zero.

## Payout amount

Payout depends on:

- How many winning shares you hold
- The market’s **redemption rate** after settlement (how much collateral each share is worth)

The Trades page shows an **estimated payout** before you claim. The final amount matches on-chain settlement math.

## If you lose

Losing shares are worth nothing at settlement. There is no claim button and no refund of your original trade amount.

## If you sold early

If you sold all your shares via limit orders before settlement, you have nothing to claim — you already exited for whatever the buyer paid.

## Unclaimed winnings

Winning shares do not expire immediately after settlement, but you should claim when convenient. Collateral remains in the market contract until redeemed.

## Price markets vs event markets

Claiming works the same for both types. Only the path **to** settlement differs — see [How settlement works](../markets/how-settlement-works.md).

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| No claim button | Confirm market is settled and you hold the winning outcome |
| Transaction fails | Check network, gas, and wallet connection |
| Lower payout than expected | You may have bought late at a high implied price; fees were charged on entry |

[Market lifecycle →](../markets/market-lifecycle.md)

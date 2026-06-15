# How staking works

The Mondalore **fee vault** collects protocol revenue from trading and routes a portion to MONDO stakers.

## Deposit

1. Open the **Stake** page.
2. Enter a MONDO amount (or tap **Max**).
3. Approve MONDO spending if prompted.
4. Confirm **Stake MONDO**.

You receive sMONDO equal to the amount staked.

## Lock period

Each deposit has a **minimum lock duration**. Until the lock expires, that deposit cannot be withdrawn.

Important behaviors:

- **New deposits start their own lock** — topping up does not reset earlier deposits’ unlock times.
- **Once unlocked**, withdrawal for that deposit is available immediately (subject to gas and wallet confirmation).

The Stake page shows time remaining until unlock when you have an active position.

## Fee share

Stakers receive **0.2%** of each market trade’s notional — drawn from the protocol’s 1.2% fee slice — distributed **pro-rata** among stakers in the vault.

The remaining protocol fee portion accrues to treasury per vault rules.

See [Reference — Fees](../reference/fees.md) for the full split.

## Epochs

The vault tracks **epochs** for accounting. Your Stake page shows the current epoch. Rewards accumulate over time and appear as **claimable** when available.

## What staking does not do

- It does not trade prediction markets for you
- It does not guarantee fixed APY — rewards depend on total trading volume and total staked MONDO
- It does not remove lock requirements

## Risks to understand

- MONDO price may fluctuate while staked
- Smart contract and vault rules apply — only stake what you accept holding through the lock
- Low platform volume means lower reward accrual

[Rewards & withdrawals →](rewards-and-withdrawals.md)

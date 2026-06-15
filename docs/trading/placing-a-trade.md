# Placing a trade

This walkthrough covers a **market trade** — the fastest way to open a position.

## Step 1 — Open a market

From the Markets list, select a market. On the detail page you will see the question, chart, outcomes, and trade panel.

## Step 2 — Choose an outcome

- **Binary markets:** tap **Yes** or **No** (or the custom labels the creator set).
- **Multi-outcome markets:** select one option from the list.

The probability shown beside each outcome updates as other traders add collateral.

## Step 3 — Enter an amount

Type how much collateral you want to spend (in USDC or MON, matching the market). You can use quick-add buttons or **Max** to fill your available wallet balance.

The panel estimates:

- **Shares** you will receive
- **Effective price** per share
- **Fee** deducted from your input

## Step 4 — Review slippage

**Slippage** is a safety buffer. If the pool price moves between when you submit and when the transaction confirms, slippage prevents you from receiving far fewer shares than expected. Tap the slippage control to cycle through preset tolerances if you are comfortable with more or less protection.

## Step 5 — Approve (if needed)

For USDC markets, your first trade may require a separate **Approve** transaction. Confirm it in your wallet, then submit the trade.

## Step 6 — Confirm the trade

Click **Buy [Outcome]** and approve the transaction in your wallet. Wait for confirmation — the app will show success or an error message.

## What you receive

You receive **outcome shares** in your wallet. They appear on:

- The market page (your balance for that outcome)
- The **Trades** page (all positions)

Shares are transferable. You can sell them via a **limit sell order** before settlement if you want to exit early.

## When trading is blocked

You cannot place a new pool trade if:

- The market is not **Open**
- Current time is past **stake end**
- Your wallet is disconnected or on the wrong network
- Your balance is insufficient (including gas)

Trading closes at **stake end**. Settlement happens later at **resolve after** — see [Market lifecycle](../markets/market-lifecycle.md).

## Selling before settlement

To sell shares you already hold, switch the trade panel to **Limit** mode, choose **Sell**, set your price and share amount, and submit. See [Market vs limit orders](market-vs-limit-orders.md).

## Next

[Market vs limit orders](market-vs-limit-orders.md) · [Fees & slippage](fees-and-slippage.md)

# FAQ

## Getting started

### Do I need an email account?

No. You connect a crypto wallet. Your wallet address is your account.

### Which tokens do I need?

- **USDC or MON** to trade markets (match the market’s collateral)
- **MONDO** to stake on the Stake page
- A small amount of **native gas token** for transaction fees

### Why is the app asking me to switch networks?

Mondalore only runs on its deployed network. Switch in your wallet when prompted.

---

## Trading

### Can I sell my position before the market ends?

Yes, via **limit sell orders** on the order book. You cannot sell back into the pool with a market trade.

### Why did my trade fail?

Common reasons: past **stake end**, insufficient balance, slippage too tight, wrong network, or not approving USDC first.

### Does 70% probability mean I will win 70% of my money back?

No. Probability is crowd-implied odds, not a payout guarantee. If you lose, you lose your stake on that outcome. If you win, payout depends on parimutuel share math.

### What is the minimum trade size?

Very small trades may fail because fees and rounding leave zero shares. Use the amount shown in the trade panel — if shares estimate to zero, increase the amount.

---

## Positions & claims

### Where do I see my positions?

The **Trades** page lists all markets where you hold shares.

### When can I claim?

After the market is **settled** and you hold the **winning outcome** shares.

### I lost. Do I need to do anything?

No. Losing shares are worthless after settlement.

### I won but do not see a claim button.

Confirm settlement finished, you hold the winning outcome (not a losing one), and your wallet is connected. Refresh after a minute if settlement just occurred.

---

## Markets & settlement

### What is the difference between event, price, and Nad markets?

**Event** markets use real-world results verified via resolution sources and admin signatures. **Price** markets use an official asset price at resolve time automatically. **Nad** markets use [Nad.fun](https://nad.fun) token stats (market cap, price, or holders) at resolve — also automatic. See [Nad markets](../creating-markets/nad-markets.md).

### Who decides event market outcomes?

**Protocol admins** review the creator’s resolution sources and confirm the winning outcome. Multiple admin confirmations are required — the creator alone cannot settle.

### Can the creator settle their own market alone?

No. Event settlement requires the admin threshold, not the creator alone.

### What if the real-world result is disputed?

Trade carefully on ambiguous questions. Settlement follows on-chain rules and admin review of listed sources — not social media consensus.

---

## Creating markets

### Can anyone create a market?

Yes, market creation is permissionless in this deployment.

### Do I have to seed liquidity?

Strongly recommended for credible opening odds, but check the create flow for minimum requirements.

### How do I earn as a creator?

You receive **0.3%** of every pool trade on your market automatically.

### What kinds of events should I create?

Choose events where the winner can be verified from **public, official records** — government results, league scoreboards, regulatory filings, and similar. Skip subjective questions or outcomes that will never appear on a credible public page.

### Can I import a Polymarket market?

Yes, on Create → **Event**, use **Import from Polymarket** and paste a Polymarket URL. Title, description, cover, outcomes, and schedule are prefilled. Review and edit before submitting. The Mondalore market still settles through protocol admins — it is not linked to Polymarket settlement. Details: [Event markets](../creating-markets/event-markets.md#import-from-polymarket-optional).

### Can I get help before creating a market?

Yes. Reach out on Telegram — [@mondalorecommunity](https://t.me/mondalorecommunity) — to sanity-check your question, resolution sources, timing, or an unusual situation before you publish.

### Where are the contract addresses?

See [Deployments](deployments.md) for Monad Testnet and Monad Mainnet chain IDs and contract addresses. Mainnet Mondalore deployments are **TBA**.

---

## Staking

### What is the difference between MONDO staking and market “stake end”?

**MONDO staking** is depositing MONDO in the fee vault for protocol rewards. **Stake end** on a market is when trading closes for that prediction market. Unrelated concepts.

### Can I withdraw MONDO immediately after staking?

No. Each deposit has a **minimum lock**. After unlock, withdrawal is available.

### Does staking guarantee a fixed return?

No. Rewards depend on trading volume and your share of total staked MONDO.

---

## Safety

### Does Mondalore hold my funds?

No. Funds stay in your wallet until you approve a transaction. Smart contracts hold pool collateral according to market rules.

### Is on-chain activity private?

No. Wallet addresses and transactions are public on the blockchain.

---

## Still stuck?

Re-read the relevant guide:

- [Placing a trade](../trading/placing-a-trade.md)
- [Claiming winnings](../positions/claiming-winnings.md)
- [How settlement works](../markets/how-settlement-works.md)
- [Glossary](glossary.md)

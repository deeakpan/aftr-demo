# FAQ

## Getting started

### Do I need MetaMask?

No. Sign in with **Para** (email, phone, or social). Para provides the wallet used for balances and signing. See [Sign in (Para)](../getting-started/connect-wallet.md).

### Which tokens do I need?

- **USDC** (or the market’s listed collateral, e.g. USDG) to trade
- A small amount of **native gas** (ETH on Unichain Sepolia) for transaction fees

### Why is a transaction failing with a network error?

Zedkr Market only runs on its deployed network (currently **Unichain Sepolia**, chain ID `1301`). Confirm Para / the app is on that network. See [Deployments](deployments.md).

---

## Trading

### Can I sell my position before the market ends?

Yes, via **limit sell orders** on the order book. You cannot sell back into the pool with a market trade.

### Why did my trade fail?

Common reasons: past **stake end**, insufficient balance, slippage too tight, wrong network, or not approving the collateral token first.

### Does 70% probability mean I will win 70% of my money back?

No. Probability is crowd-implied odds, not a payout guarantee. If you lose, you lose your stake on that outcome. If you win, payout depends on FPMM share math.

### What is the minimum trade size?

Very small trades may fail because fees and rounding leave zero shares. Use the amount shown in the trade panel - if shares estimate to zero, increase the amount.

---

## Positions & claims

### Where do I see my positions?

The **Trades** page lists all markets where you hold shares.

### When can I claim?

After the market is **settled** and you hold the **winning outcome** shares.

### I lost. Do I need to do anything?

No. Losing shares are worthless after settlement.

### I won but do not see a claim button.

Confirm settlement finished, you hold the winning outcome (not a losing one), and you are signed in. Refresh after a minute if settlement just occurred.

---

## Markets & settlement

### What is the difference between Event, Price, Token, and RWA markets?

| Type | Settles from |
|------|----------------|
| **Event** | Real-world results, checked by admins against the creator's resolution sources |
| **Price** | Asset price rule at resolve (automatic) |
| **Token** | DEX pool stats from the market's pool links (automatic) |
| **RWA (Prism)** | Prism catalogue stats (automatic) |

See [Market types](../markets/market-types.md) and [How settlement works](../markets/how-settlement-works.md).

### Who decides event market outcomes?

**Protocol admins.** They review the creator's resolution sources and confirm the winner. Several admins must agree. The creator alone cannot settle.

### Can the creator settle their own market alone?

No.

### What if the real-world result is disputed?

Trade carefully on ambiguous questions. Settlement follows the listed resolution sources and admin review, not social media consensus.

---

## Creating markets

### Can anyone create a market?

Yes, market creation is permissionless in this deployment.

### Do I have to seed liquidity?

Strongly recommended for credible opening odds, but check the create flow for minimum requirements.

### How do I earn as a creator?

You receive **0.25%** of every pool trade on your market automatically (creator share of the **1%** fee).

### What kinds of events should I create?

Choose events where the winner can be verified from **public, official records** - government results, league scoreboards, regulatory filings, and similar. Skip subjective questions or outcomes that will never appear on a credible public page.

### Can I import a Polymarket market?

Yes, on Create → **Event**, use **Import from Polymarket** and paste a Polymarket URL. Title, description, cover, outcomes, and schedule are prefilled. Review and edit before submitting. The Zedkr Market listing still settles through protocol admins - it is not linked to Polymarket settlement. Details: [Event markets](../creating-markets/event-markets.md#import-from-polymarket-optional).

### Can I get help before creating a market?

Yes. Reach out on Telegram - [@zedkrcommunity](https://t.me/zedkrcommunity) - to sanity-check your question, resolution sources, timing, or an unusual situation before you publish.

### Where are the contract addresses?

See [Deployments](deployments.md) for Unichain Sepolia chain ID and contract addresses. Production deployments are announced separately.

---

## Safety

### Does Zedkr Market hold my funds?

No. Funds stay in your Para wallet until you approve a transaction. Smart contracts hold pool collateral according to market rules.

### Is on-chain activity private?

No. Wallet addresses and transactions are public on the blockchain.

---

## Still stuck?

Re-read the relevant guide:

- [Placing a trade](../trading/placing-a-trade.md)
- [Claiming winnings](../positions/claiming-winnings.md)
- [How settlement works](../markets/how-settlement-works.md)
- [Glossary](glossary.md)

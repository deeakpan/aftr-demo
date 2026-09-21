# Connect / sign in

Zedkr uses **Para** for sign-in. Your account is a Para wallet (email, phone, or social) that holds funds and signs trades - not a MetaMask / WalletConnect “connect every visit” flow.

## How to sign in

1. Click **Sign in** in the header (or when a trade requires it).
2. Complete Para login - email, phone, or supported social (Google, Apple, X, etc.).
3. Para creates or unlocks an **embedded wallet** for this app.

You do **not** need MetaMask installed. Injected wallets are not used for session identity on Zedkr.

## What signing in does - and does not do

**Signing in does:**

- Give you a wallet address the app uses for balances, trades, and claims.
- Let Para sign transactions for markets on the deployed network.

**Signing in does not:**

- Give Zedkr custody of your funds outside normal on-chain approvals/transactions.
- Automatically prompt MetaMask or other browser extensions on page load.

## Display name

After you are signed in, you may be prompted to choose a **display name** (nickname). That is separate from Para auth - see [Your account & display name](your-account.md).

## Wrong network

Trades run on Zedkr’s deployed chain. If a transaction fails with a network error, confirm Para / the app is set to the network listed in [Deployments](../reference/deployments.md).

## Security tips

- Only sign in on the official Zedkr site.
- Review every transaction Para presents before approving.
- Never share recovery secrets or seed phrases with anyone claiming to be support.

## Next

[Your account & display name](your-account.md)

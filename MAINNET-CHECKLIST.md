# Robinhood mainnet readiness checklist

Unichain Sepolia (`1301`) uses **mock** Chainlink feeds for cheap testing.  
Robinhood (`4663`) already has **real** Chainlink on the live stack — going back is mostly an env flip.  
Token markets + the new 25/25/25/25 fee split require finishing the mid-redeploy first.

---

## Flip app → Robinhood (real Chainlink again)

Do this in root `.env`, `admin/.env`, and `resolver/.env`:

- [ ] `DEPLOYMENT_CHAIN_ID=4663`
- [ ] `NEXT_PUBLIC_DEPLOYMENT_CHAIN_ID=4663`
- [ ] `RPC_URL` / `NEXT_PUBLIC_RPC_URL` → Alchemy (or another working Robinhood RPC; public RPC is flaky / Cloudflare-gated)
- [ ] Restart Next, admin, and resolver
- [ ] Confirm create UI shows live BTC/ETH/etc feeds from `deployments/robinhoodMainnet-4663.json` → `external.chainlinkFeeds` (not Unichain mock `$3500` / `$100k`)

No need to “switch feeds” on Unichain — stop targeting `1301`.

---

## A. Contracts / deploy

Current live factory (old fees / no `createTokenMarket`):  
`ZedkrFpmmMarketFactory` `0x92685D2Ca3025EE1c34A18e5c3aC1153F3797F04`

Mid-redeploy progress: `deployments/robinhood-fpmm-redeploy.json`  
(new registry + factory landed; stopped at deployer — insufficient ETH)

- [ ] Fund deployer `0x7A981A271E12Dd22B61f9028F8CAf526ba53c3C5` (~0.005+ ETH)
- [ ] Finish `npx hardhat run scripts/deploy-fpmm-sequential.cjs --network robinhoodMainnet`  
  Remaining: FPMM deployer, `setMarketDeployer`, resolution admins, `setTokenResolutionAdmin`, Chainlink feeds, collateral whitelist, orderbook adapter / orderbook as needed
- [ ] Merge new addresses into `deployments/robinhoodMainnet-4663.json` (+ `admin/deployments/` copy)
- [ ] Point app at the **new** factory (cut over JSON; do not leave half-live)
- [ ] Confirm real Chainlink feeds registered on the new factory (`set-price-feeds` / deploy path)
- [ ] `tokenResolutionAdmin` = resolver bot wallet
- [ ] ≥3 `RESOLUTION_ADMINS` for event markets
- [ ] `setFeeSplit(platformDev, distribution, treasury)` for 25/25/25/25 (address(0) share → creator)

---

## B. Collateral / product smoke

- [ ] Decide trading collateral: keep `USE_MOCK_USDG=1` / `NEXT_PUBLIC_USE_MOCK_USDG=1` (mintable `contracts.USDG`) vs real/canonical USDG
- [ ] **Price** market: create → trade → past resolve → `settlePrice` reads live Chainlink
- [ ] **Event** market: create → 3 admin signatures → resolve
- [ ] **Token** market: Dexscreener/Gecko pool link → operator `resolveToken`  
  (only after new factory with `createTokenMarket` / `resolveToken` is live)

---

## C. App / ops

- [ ] Para works on Robinhood `4663` (session + send path + correct chain)
- [ ] Resolver bot running; wallet matches `tokenResolutionAdmin`
- [ ] Subgraph: Studio is weak/unsupported for Robinhood — prefer Goldsky (or rely on factory RPC fallback). Update `SUBGRAPH_QUERY_URL` + start blocks for the cut-over factory
- [ ] Prod env must not still say `1301` / Unichain RPC

---

## D. Optional cleanup

- [ ] How-it-works / docs match shipped UX (token = Dex/Gecko link + operator)
- [ ] Keep Unichain Sepolia as cheap staging; Robinhood as prod
- [ ] Document faucet / mock-feed workflow for Unichain only (not mainnet)

---

## Quick reference

| Item | Unichain Sepolia | Robinhood mainnet |
| --- | --- | --- |
| Chain ID | `1301` | `4663` |
| Deployment JSON | `deployments/unichainSepolia-1301.json` | `deployments/robinhoodMainnet-4663.json` |
| Price oracles | MockChainlinkFeed (`setAnswer`) | Real Chainlink |
| Hardhat network | `unichainSepolia` | `robinhoodMainnet` |
| Suggested RPC | `https://unichain-sepolia-rpc.publicnode.com` | Alchemy Robinhood URL |

**Short path:** env → `4663` + good RPC for current price/event stack.  
**Full path (token markets + new fees):** finish sequential redeploy → merge JSON → then cut over.

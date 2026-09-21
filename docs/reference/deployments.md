# Deployments

The live Zedkr app currently runs on **Unichain Sepolia** (testnet). Confirm the network after you **sign in with Para** before trading or creating.

Each market also has its own contract address (created by the factory). You will see that address on the market detail page.

---

## Networks at a glance

<div class="table-scroll">

<table class="deployments-table deployments-table--stack-sm">
<caption>Network overview</caption>
<thead>
<tr>
<th>Network</th>
<th>Chain ID</th>
<th>RPC</th>
<th>Explorer</th>
</tr>
</thead>
<tbody>
<tr>
<td data-label="Network"><strong>Unichain Sepolia</strong> (current)</td>
<td data-label="Chain ID"><span class="ca">1301</span></td>
<td data-label="RPC"><span class="ca">https://unichain-sepolia-rpc.publicnode.com</span></td>
<td data-label="Explorer"><a href="https://sepolia.uniscan.xyz">Uniscan</a></td>
</tr>
<tr>
<td data-label="Network"><strong>Robinhood Chain</strong></td>
<td data-label="Chain ID"><span class="ca">4663</span></td>
<td data-label="RPC"><span class="ca">https://rpc.mainnet.chain.robinhood.com</span></td>
<td data-label="Explorer"><a href="https://explorer.robinhood.com">Blockscout</a></td>
</tr>
</tbody>
</table>

</div>

| | Unichain Sepolia | Production |
|---|------------------|------------|
| **Native gas token** | ETH | Depends on target chain |
| **Zedkr app** | Live (test) | Follow Telegram for announcements |

---

## Unichain Sepolia

<span class="network-badge">Chain ID 1301</span>

The live app currently uses **Unichain Sepolia**. Trading collaterals include **Zedkr USDC**, **USDG**, and related test assets listed below.

<div class="table-scroll">

<table class="deployments-table deployments-table--stack-sm">
<caption>Contract addresses</caption>
<thead>
<tr>
<th>Contract</th>
<th>Address</th>
</tr>
</thead>
<tbody>
<tr>
<td data-label="Contract">Market factory (FPMM)</td>
<td data-label="Address"><span class="ca">0x72B641a21Dc4e929ce5057016fA9aCFeB927624b</span></td>
</tr>
<tr>
<td data-label="Contract">Order book</td>
<td data-label="Address"><span class="ca">0xFd5109fA917203947E350218928e3e39f5936813</span></td>
</tr>
<tr>
<td data-label="Contract">Fee vault</td>
<td data-label="Address"><span class="ca">0x13Df5A0CEc379346D9a498a74a7580d6e2983b45</span></td>
</tr>
<tr>
<td data-label="Contract">Collateral registry</td>
<td data-label="Address"><span class="ca">0xD9A1F6b06E016AFe9b2C277410F69Eec2Ed0B050</span></td>
</tr>
<tr>
<td data-label="Contract">Zedkr USDC</td>
<td data-label="Address"><span class="ca">0xA5424DD5165ed2516fD5590fe229E91B2F7707E8</span></td>
</tr>
<tr>
<td data-label="Contract">USDG</td>
<td data-label="Address"><span class="ca">0x20f4BaE7793aE79bBeA9eA680516038cB5aCB23b</span></td>
</tr>
<tr>
<td data-label="Contract">Mock WETH</td>
<td data-label="Address"><span class="ca">0x4C50167f92544cb4755bc8f35a4efDbE7c3c9B40</span></td>
</tr>
</tbody>
</table>

</div>

Indexer: Goldsky subgraph `zedkr-unichain` (used by the app for market lists and activity).

---

## Other networks

Deployments may also exist on **Robinhood Chain** or other targets for production. Addresses and chain IDs are configured per environment (`NEXT_PUBLIC_DEPLOYMENT_CHAIN_ID`). When the public app moves, this page will be updated - or ask [@zedkrcommunity](https://t.me/zedkrcommunity).

---

## Which network am I on?

1. Sign in with Para and check that transactions target **Unichain Sepolia** (chain ID `1301`) while the test app is live.
2. Compare the factory address on a market page to the table above.
3. Open contracts on [Uniscan](https://sepolia.uniscan.xyz) to confirm.

## Need help?

Wrong network, missing contract, or questions before production launch - message [@zedkrcommunity](https://t.me/zedkrcommunity) on Telegram.

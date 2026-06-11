/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

async function main() {
  process.env.HARDHAT_NETWORK = process.env.HARDHAT_NETWORK || "baseSepolia";
  const hre = require("hardhat");
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;
  const file = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const factoryAddress = parsed.contracts.MondaloreParimutuelMarketFactory;
  const factory = await hre.ethers.getContractAt("MondaloreParimutuelMarketFactory", factoryAddress);
  const total = Number(await factory.marketsLength());
  const now = Math.floor(Date.now() / 1000);

  const stateLabel = (s) => (s === 0 ? "OPEN" : s === 1 ? "AWAITING_UMA" : s === 2 ? "SETTLED" : `?${s}`);
  const kindLabel = (k) => (k === 0 ? "PRICE" : "EVENT");

  console.log(`Network: ${networkName} (${chainId}) | now: ${now} (${new Date(now * 1000).toISOString()})`);
  console.log(`Factory: ${factoryAddress} | markets: ${total}\n`);

  const pending = [];

  for (let i = 0; i < total; i += 1) {
    const addr = await factory.markets(BigInt(i));
    const market = await hre.ethers.getContractAt("MondaloreVParimutuelMarket", addr);
    const [kind, state, stakeEnd, resolveAfter, uri] = await Promise.all([
      market.marketKind(),
      market.state(),
      market.stakeEndTimestamp(),
      market.resolveAfterTimestamp(),
      market.metadataURI(),
    ]);
    const st = Number(state);
    const k = Number(kind);
    const stake = Number(stakeEnd);
    const resolve = Number(resolveAfter);
    const readyToSettle = st !== 2 && now >= resolve;
    const stakeEnded = now >= stake;

    console.log(`#${i} ${addr}`);
    console.log(`  kind=${kindLabel(k)} state=${stateLabel(st)} stakeEnd=${stake} resolveAfter=${resolve}`);
    console.log(`  stakeEnded=${stakeEnded} readyToSettle=${readyToSettle}`);
    console.log(`  metadataURI=${String(uri).slice(0, 60)}${String(uri).length > 60 ? "…" : ""}`);

    if (readyToSettle) {
      pending.push({ id: i, address: addr, kind: k, state: st });
    }
    console.log("");
  }

  console.log("--- Pending settlement (resolveAfter passed, not SETTLED) ---");
  if (pending.length === 0) {
    console.log("None");
  } else {
    for (const p of pending) {
      console.log(`  id=${p.id} ${p.address} ${kindLabel(p.kind)} ${stateLabel(p.state)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

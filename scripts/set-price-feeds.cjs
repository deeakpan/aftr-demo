/* eslint-disable no-console */
/**
 * Register factory price feeds by asset key (owner-only).
 *
 * Usage:
 *   npx hardhat run scripts/set-price-feeds.cjs --network monadTestnet
 *
 * Registers BTC from deployments/monadTestnet-10143.json → contracts.MockBtcUsdFeed
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployments", "monadTestnet-10143.json");

function assetKey(symbol) {
  return hre.ethers.keccak256(hre.ethers.toUtf8Bytes(symbol.trim().toUpperCase()));
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const factoryAddr = dep.contracts?.MondaloreParimutuelMarketFactory;
  const btcFeed = dep.contracts?.MockBtcUsdFeed;
  if (!factoryAddr) throw new Error("MondaloreParimutuelMarketFactory missing in deployment JSON");
  if (!btcFeed) throw new Error("MockBtcUsdFeed missing — run deploy:mock-btc-feed first");

  const [signer] = await hre.ethers.getSigners();
  const factory = await hre.ethers.getContractAt("MondaloreParimutuelMarketFactory", factoryAddr);

  const btcKey = assetKey("BTC");
  console.log("Factory:", factoryAddr);
  console.log("Signer:", signer.address);
  console.log("Setting BTC feed:", btcFeed, "key:", btcKey);

  const tx = await factory.setPriceFeed(btcKey, btcFeed);
  await tx.wait();
  console.log("priceFeeds[BTC] registered ✓");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

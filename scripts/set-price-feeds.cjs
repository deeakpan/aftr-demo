/* eslint-disable no-console */
/**
 * Register factory price feeds from deployment JSON chainlinkFeeds (owner-only).
 *
 * Usage:
 *   npx hardhat run scripts/set-price-feeds.cjs --network robinhoodMainnet
 *   npx hardhat run scripts/set-price-feeds.cjs --network monadTestnet
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { registerPriceFeedsOnFactory } = require("./lib/register-price-feeds.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DEPLOYMENTS_BY_NETWORK = {
  robinhoodMainnet: "robinhoodMainnet-4663.json",
  monadTestnet: "monadTestnet-10143.json",
};

async function main() {
  const networkName = hre.network.name;
  const fileName = DEPLOYMENTS_BY_NETWORK[networkName];
  if (!fileName) {
    throw new Error(
      `No deployment mapping for network "${networkName}". Supported: ${Object.keys(DEPLOYMENTS_BY_NETWORK).join(", ")}`,
    );
  }

  const depPath = path.join(__dirname, "..", "deployments", fileName);
  const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
  const factoryAddr = dep.contracts?.MondaloreParimutuelMarketFactory;
  if (!factoryAddr || factoryAddr === "0x0000000000000000000000000000000000000000") {
    throw new Error(`MondaloreParimutuelMarketFactory not deployed in ${fileName}`);
  }

  const feeds = dep.external?.chainlinkFeeds ?? [];
  if (feeds.length === 0) {
    throw new Error(`No external.chainlinkFeeds in ${fileName}`);
  }

  const [signer] = await hre.ethers.getSigners();
  const factory = await hre.ethers.getContractAt("MondaloreParimutuelMarketFactory", factoryAddr);

  console.log("Factory:", factoryAddr);
  console.log("Signer:", signer.address);
  console.log(`Registering ${feeds.length} feed(s) from ${fileName}…`);

  const { registered, skipped } = await registerPriceFeedsOnFactory(factory, feeds, hre.ethers);
  console.log(`Done — ${registered} updated, ${skipped} unchanged/skipped.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

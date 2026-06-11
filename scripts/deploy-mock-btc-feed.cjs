/* eslint-disable no-console */
/**
 * Deploy Ownable MockChainlinkFeed for BTC/USD on Monad testnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-mock-btc-feed.cjs --network monadTestnet
 *
 * Env:
 *   MOCK_BTC_PRICE_USD  — initial price in USD (default: 95000)
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployments", "monadTestnet-10143.json");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const initialUsd = Number(process.env.MOCK_BTC_PRICE_USD?.trim() || "95000");
  const decimals = 8;
  const initialAnswer = BigInt(Math.round(initialUsd * 10 ** decimals));

  console.log("Deployer:", deployer.address);
  console.log(`Initial BTC/USD: $${initialUsd.toLocaleString()} (${initialAnswer} with ${decimals} decimals)`);

  const FeedF = await hre.ethers.getContractFactory("MockChainlinkFeed");
  const feed = await FeedF.deploy(initialAnswer, decimals, deployer.address);
  await feed.waitForDeployment();
  const address = await feed.getAddress();
  const blockNumber = (await feed.deploymentTransaction().wait()).blockNumber;

  console.log(`MockChainlinkFeed (BTC/USD): ${address} (block ${blockNumber})`);
  console.log(`Owner can update via setAnswer() — e.g. hardhat console or cast send`);

  let dep = {};
  if (fs.existsSync(DEPLOYMENT_FILE)) {
    dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  }

  const btcFeed = {
    label: "BTC/USD",
    asset: "BTC",
    logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
    address,
    mock: true,
    decimals,
  };

  dep.external = dep.external ?? {};
  dep.external.chainlinkFeeds = [btcFeed];
  dep.contracts = dep.contracts ?? {};
  dep.contracts.MockBtcUsdFeed = address;
  dep.deploymentBlocks = dep.deploymentBlocks ?? {};
  dep.deploymentBlocks.MockBtcUsdFeed = blockNumber;

  fs.writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(dep, null, 2)}\n`, "utf8");
  console.log("Updated", DEPLOYMENT_FILE);

  const factoryAddr = dep.contracts?.MondaloreParimutuelMarketFactory;
  if (factoryAddr) {
    const factoryContract = await hre.ethers.getContractAt(
      "MondaloreParimutuelMarketFactory",
      factoryAddr,
    );
    const btcKey = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("BTC"));
    try {
      const tx = await factoryContract.setPriceFeed(btcKey, address);
      await tx.wait();
      console.log(`Registered on factory ${factoryAddr}: priceFeeds[BTC] = ${address}`);
    } catch (e) {
      console.warn(
        "Could not register feed on factory (redeploy factory with priceFeeds support first):",
        e.shortMessage ?? e.message,
      );
      console.warn("Then run: npx hardhat run scripts/set-price-feeds.cjs --network monadTestnet");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

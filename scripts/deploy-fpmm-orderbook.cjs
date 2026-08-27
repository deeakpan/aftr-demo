/* eslint-disable no-console */
/**
 * Deploy FPMM-wired MondaloreOrderBook on Robinhood (exact same CLOB contract).
 * Uses ZedkrFpmmOrderBookFactoryAdapter so the live FPMM factory (which may lack
 * isOutcomeTokenForMarket) still works with the book.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-fpmm-orderbook.cjs --network robinhoodMainnet
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DEPLOYMENT_FILE =
  process.env.DEPLOYMENT_FILE ||
  path.join(__dirname, "..", "deployments", "robinhoodMainnet-4663.json");

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function deployAndTrack(factory, ...args) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const instance = await factory.deploy(...args);
      const receipt = await instance.deploymentTransaction().wait();
      return { instance, address: await instance.getAddress(), blockNumber: receipt.blockNumber };
    } catch (e) {
      lastErr = e;
      console.warn(`  deploy attempt ${attempt} failed: ${(e?.message || String(e)).slice(0, 160)}`);
      if (attempt < 4) await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

async function main() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error(`Missing deployment file: ${DEPLOYMENT_FILE}`);
  }
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const contracts = dep.contracts ?? {};
  const blocks = dep.deploymentBlocks ?? {};

  const fpmmFactory = contracts.ZedkrFpmmMarketFactory;
  const feeVault = contracts.MondaloreFeeVault;
  const oldBook = contracts.MondaloreOrderBook;

  if (!fpmmFactory || !feeVault) {
    throw new Error("Need ZedkrFpmmMarketFactory and MondaloreFeeVault in deployment JSON");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`FPMM factory: ${fpmmFactory}`);
  console.log(`Fee vault (treasury): ${feeVault}`);
  console.log(`Prior (pari) OrderBook: ${oldBook}`);

  console.log("\n[1/2] ZedkrFpmmOrderBookFactoryAdapter...");
  const Adapter = await hre.ethers.getContractFactory("ZedkrFpmmOrderBookFactoryAdapter");
  const { address: adapterAddr, blockNumber: adapterBlock } = await deployAndTrack(
    Adapter,
    fpmmFactory,
  );
  console.log(`  Adapter: ${adapterAddr} (block ${adapterBlock})`);

  console.log("\n[2/2] MondaloreOrderBook (FPMM)...");
  const OrderBook = await hre.ethers.getContractFactory("MondaloreOrderBook");
  const { address: bookAddr, blockNumber: bookBlock } = await deployAndTrack(
    OrderBook,
    adapterAddr,
    deployer.address,
    feeVault,
  );
  console.log(`  OrderBook: ${bookAddr} (block ${bookBlock})`);

  // Preserve pari book; app + subgraph use MondaloreOrderBook → FPMM.
  if (oldBook && oldBook.toLowerCase() !== bookAddr.toLowerCase()) {
    contracts.MondaloreOrderBookParimutuel = oldBook;
    if (blocks.MondaloreOrderBook != null && blocks.MondaloreOrderBookParimutuel == null) {
      blocks.MondaloreOrderBookParimutuel = blocks.MondaloreOrderBook;
    }
  }
  contracts.ZedkrFpmmOrderBookFactoryAdapter = adapterAddr;
  contracts.MondaloreOrderBook = bookAddr;
  blocks.ZedkrFpmmOrderBookFactoryAdapter = adapterBlock;
  blocks.MondaloreOrderBook = bookBlock;

  dep.contracts = contracts;
  dep.deploymentBlocks = blocks;
  dep.notes = {
    ...(dep.notes ?? {}),
    orderBook: "MondaloreOrderBook is the FPMM CLOB (exact MondaloreOrderBook bytecode) via ZedkrFpmmOrderBookFactoryAdapter. MondaloreOrderBookParimutuel is the earlier pari-wired instance.",
  };

  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(dep, null, 2) + "\n", "utf8");
  console.log(`\nUpdated ${DEPLOYMENT_FILE}`);
  console.log(`  MondaloreOrderBook (FPMM): ${bookAddr}`);
  console.log(`  Adapter:                  ${adapterAddr}`);
  if (contracts.MondaloreOrderBookParimutuel) {
    console.log(`  Pari OrderBook (kept):    ${contracts.MondaloreOrderBookParimutuel}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

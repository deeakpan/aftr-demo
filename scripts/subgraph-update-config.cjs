/**
 * subgraph-update-config.cjs
 *
 * Patches subgraph/subgraph.yaml with FPMM factory + vault + order book addresses.
 *
 * Usage:
 *   DEPLOYMENT_FILE=deployments/robinhoodMainnet-4663.json SUBGRAPH_NETWORK=robinhood-mainnet node scripts/subgraph-update-config.cjs
 */
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE
  ? path.resolve(process.env.DEPLOYMENT_FILE)
  : path.join(__dirname, "..", "deployments", "robinhoodMainnet-4663.json");
const SUBGRAPH_YAML = path.join(__dirname, "..", "subgraph", "subgraph.yaml");
const SUBGRAPH_NETWORK = process.env.SUBGRAPH_NETWORK ?? "robinhood-mainnet";

function isDeployed(addr) {
  return typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr) && !/^0x0+$/i.test(addr);
}

function main() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error("Deployment file not found:", DEPLOYMENT_FILE);
    process.exit(1);
  }

  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const contracts = dep.contracts ?? {};
  const blocks = dep.deploymentBlocks ?? {};

  const vault = contracts.MondaloreFeeVault;
  const fpmmFactory = contracts.ZedkrFpmmMarketFactory;
  const orderBook = contracts.MondaloreOrderBook;
  const vaultBlock = blocks.MondaloreFeeVault ?? 1;
  const fpmmFactoryBlock = blocks.ZedkrFpmmMarketFactory ?? 1;
  const orderBookBlock = blocks.MondaloreOrderBook ?? 1;

  if (!isDeployed(vault) || !isDeployed(fpmmFactory)) {
    console.error("Missing ZedkrFpmmMarketFactory or MondaloreFeeVault in deployment JSON.");
    process.exit(1);
  }

  let yaml = fs.readFileSync(SUBGRAPH_YAML, "utf8");
  yaml = yaml.replace(/network:\s*[\w-]+/g, `network: ${SUBGRAPH_NETWORK}`);
  yaml = patchSource(yaml, "FpmmFactory", fpmmFactory, fpmmFactoryBlock);
  yaml = patchSource(yaml, "Vault", vault, vaultBlock);
  if (isDeployed(orderBook)) {
    yaml = patchSource(yaml, "OrderBook", orderBook, orderBookBlock);
  }

  fs.writeFileSync(SUBGRAPH_YAML, yaml, "utf8");
  console.log("Updated subgraph/subgraph.yaml (FPMM + OrderBook):");
  console.log(`  network     → ${SUBGRAPH_NETWORK}`);
  console.log(`  FpmmFactory → ${fpmmFactory} (startBlock: ${fpmmFactoryBlock})`);
  console.log(`  Vault       → ${vault} (startBlock: ${vaultBlock})`);
  if (isDeployed(orderBook)) {
    console.log(`  OrderBook   → ${orderBook} (startBlock: ${orderBookBlock})`);
  } else {
    console.log("  OrderBook   → (skipped — not in deployment)");
  }
  console.log("  Template    → FpmmMarket (buy/sell/redeem)");
}

function patchSource(yaml, name, address, startBlock) {
  const addressRe = new RegExp(
    `(name:\\s*${name}[\\s\\S]*?source:[\\s\\S]*?address:\\s*")[^"]*(")`,
  );
  yaml = yaml.replace(addressRe, `$1${address}$2`);

  const blockRe = new RegExp(
    `(name:\\s*${name}[\\s\\S]*?source:[\\s\\S]*?startBlock:\\s*)\\d+`,
  );
  yaml = yaml.replace(blockRe, `$1${startBlock}`);

  return yaml;
}

main();

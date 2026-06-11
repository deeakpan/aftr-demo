/**
 * subgraph-update-config.cjs
 *
 * Reads deployments/monadTestnet-10143.json (override via DEPLOYMENT_FILE) and patches
 * subgraph/subgraph.yaml with contract addresses, startBlock values, and network.
 *
 * Usage:
 *   node scripts/subgraph-update-config.cjs
 */
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE
  ? path.resolve(process.env.DEPLOYMENT_FILE)
  : path.join(__dirname, "..", "deployments", "monadTestnet-10143.json");
const SUBGRAPH_YAML = path.join(__dirname, "..", "subgraph", "subgraph.yaml");
const SUBGRAPH_NETWORK = process.env.SUBGRAPH_NETWORK ?? "monad-testnet";

function main() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error("Deployment file not found:", DEPLOYMENT_FILE);
    process.exit(1);
  }

  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const contracts = dep.contracts ?? {};
  const blocks = dep.deploymentBlocks ?? {};

  const factory = contracts.MondaloreParimutuelMarketFactory;
  const vault = contracts.MondaloreFeeVault;

  const factoryBlock = blocks.MondaloreParimutuelMarketFactory ?? 1;
  const vaultBlock = blocks.MondaloreFeeVault ?? 1;

  if (!factory || !vault) {
    console.error("Missing Factory or Vault in deployment JSON. Run the deploy script first.");
    process.exit(1);
  }

  let yaml = fs.readFileSync(SUBGRAPH_YAML, "utf8");

  yaml = yaml.replace(/network:\s*[\w-]+/g, `network: ${SUBGRAPH_NETWORK}`);
  yaml = patchSource(yaml, "Factory", factory, factoryBlock);
  yaml = patchSource(yaml, "Vault", vault, vaultBlock);

  fs.writeFileSync(SUBGRAPH_YAML, yaml, "utf8");
  console.log("Updated subgraph/subgraph.yaml:");
  console.log(`  network  → ${SUBGRAPH_NETWORK}`);
  console.log(`  Factory  → ${factory} (startBlock: ${factoryBlock})`);
  console.log(`  Vault    → ${vault} (startBlock: ${vaultBlock})`);
  console.log("  Market template → per-market Deposited / TokensRedeemed (from MarketCreated)");
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

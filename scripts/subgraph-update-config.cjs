/**
 * subgraph-update-config.cjs
 *
 * Reads deployments/baseSepolia-84532.json and patches subgraph/subgraph.yaml
 * with the correct contract addresses and startBlock values.
 *
 * Usage:
 *   node scripts/subgraph-update-config.cjs
 */
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployments", "baseSepolia-84532.json");
const SUBGRAPH_YAML = path.join(__dirname, "..", "subgraph", "subgraph.yaml");

function main() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error("Deployment file not found:", DEPLOYMENT_FILE);
    process.exit(1);
  }

  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const contracts = dep.contracts ?? {};
  const blocks = dep.deploymentBlocks ?? {};

  const factory = contracts.AFTRParimutuelMarketFactory;
  const vault = contracts.AFTRFeeVault;
  const router = contracts.AFTRMarketDebtRouter;

  const factoryBlock = blocks.AFTRParimutuelMarketFactory ?? 1;
  const vaultBlock = blocks.AFTRFeeVault ?? 1;
  const routerBlock = blocks.AFTRMarketDebtRouter ?? 1;

  if (!factory || !vault || !router) {
    console.error("Missing contract addresses in deployment JSON. Run the deploy script first.");
    process.exit(1);
  }

  let yaml = fs.readFileSync(SUBGRAPH_YAML, "utf8");

  yaml = patchSource(yaml, "Factory", factory, factoryBlock);
  yaml = patchSource(yaml, "Vault", vault, vaultBlock);
  yaml = patchSource(yaml, "Router", router, routerBlock);

  fs.writeFileSync(SUBGRAPH_YAML, yaml, "utf8");
  console.log("Updated subgraph/subgraph.yaml:");
  console.log(`  Factory  → ${factory} (startBlock: ${factoryBlock})`);
  console.log(`  Vault    → ${vault} (startBlock: ${vaultBlock})`);
  console.log(`  Router   → ${router} (startBlock: ${routerBlock})`);
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

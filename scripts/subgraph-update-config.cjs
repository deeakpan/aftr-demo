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
const SUBGRAPH_YAML   = path.join(__dirname, "..", "subgraph", "subgraph.yaml");

function main() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error("Deployment file not found:", DEPLOYMENT_FILE);
    process.exit(1);
  }

  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const contracts = dep.contracts ?? {};
  const blocks    = dep.deploymentBlocks ?? {};

  const factory     = contracts.AFTRParimutuelMarketFactory;
  const router      = contracts.AFTRMarketDebtRouter;
  const vault       = contracts.AFTRFeeVault;

  const factoryBlock = blocks.AFTRParimutuelMarketFactory ?? 1;
  const routerBlock  = blocks.AFTRMarketDebtRouter        ?? 1;
  const vaultBlock   = blocks.AFTRFeeVault                ?? 1;

  if (!factory || !router || !vault) {
    console.error("Missing contract addresses in deployment JSON. Run the deploy script first.");
    process.exit(1);
  }

  let yaml = fs.readFileSync(SUBGRAPH_YAML, "utf8");

  // Patch Factory source
  yaml = patchSource(yaml, "Factory", factory, factoryBlock);
  // Patch Router source
  yaml = patchSource(yaml, "Router", router, routerBlock);
  // Patch Vault source
  yaml = patchSource(yaml, "Vault", vault, vaultBlock);

  fs.writeFileSync(SUBGRAPH_YAML, yaml, "utf8");
  console.log("Updated subgraph/subgraph.yaml:");
  console.log(`  Factory  → ${factory} (startBlock: ${factoryBlock})`);
  console.log(`  Router   → ${router} (startBlock: ${routerBlock})`);
  console.log(`  Vault    → ${vault} (startBlock: ${vaultBlock})`);
}

/**
 * Patch the address and startBlock for a named data source in the YAML.
 * Finds the block:
 *   - kind: ethereum/contract
 *     name: <name>
 *     ...
 *     source:
 *       address: "..."
 *       ...
 *       startBlock: ...
 */
function patchSource(yaml, name, address, startBlock) {
  // Replace address line inside the named data source block
  const addressRe = new RegExp(
    `(name:\\s*${name}[\\s\\S]*?source:[\\s\\S]*?address:\\s*")[^"]*(")`
  );
  yaml = yaml.replace(addressRe, `$1${address}$2`);

  // Replace startBlock line inside the named data source block
  const blockRe = new RegExp(
    `(name:\\s*${name}[\\s\\S]*?source:[\\s\\S]*?startBlock:\\s*)\\d+`
  );
  yaml = yaml.replace(blockRe, `$1${startBlock}`);

  return yaml;
}

main();

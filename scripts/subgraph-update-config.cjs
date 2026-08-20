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

  const factory = contracts.MondaloreParimutuelMarketFactory;
  const vault = contracts.MondaloreFeeVault;
  const fpmmFactory = contracts.ZedkrFpmmMarketFactory;

  const factoryBlock = blocks.MondaloreParimutuelMarketFactory ?? 1;
  const vaultBlock = blocks.MondaloreFeeVault ?? 1;
  const fpmmFactoryBlock = blocks.ZedkrFpmmMarketFactory ?? factoryBlock;

  if (!factory || !vault) {
    console.error("Missing Factory or Vault in deployment JSON. Run the deploy script first.");
    process.exit(1);
  }

  let yaml = fs.readFileSync(SUBGRAPH_YAML, "utf8");

  yaml = yaml.replace(/network:\s*[\w-]+/g, `network: ${SUBGRAPH_NETWORK}`);
  yaml = patchSource(yaml, "Factory", factory, factoryBlock);
  yaml = patchSource(yaml, "Vault", vault, vaultBlock);

  if (isDeployed(fpmmFactory)) {
    yaml = patchSource(yaml, "FpmmFactory", fpmmFactory, fpmmFactoryBlock);
    console.log(`  FpmmFactory → ${fpmmFactory} (startBlock: ${fpmmFactoryBlock})`);
  } else {
    console.log("  FpmmFactory → not deployed (placeholder left in subgraph.yaml)");
  }

  fs.writeFileSync(SUBGRAPH_YAML, yaml, "utf8");
  console.log("Updated subgraph/subgraph.yaml:");
  console.log(`  network  → ${SUBGRAPH_NETWORK}`);
  console.log(`  Factory  → ${factory} (startBlock: ${factoryBlock})`);
  console.log(`  Vault    → ${vault} (startBlock: ${vaultBlock})`);
  console.log("  Market templates → parimutuel Deposited + FPMM buy/sell");
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

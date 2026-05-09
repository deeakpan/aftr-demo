/**
 * deploy-vault.cjs
 *
 * Deploys AFTRToken + AFTRFeeVault on top of an existing deployment,
 * wires the vault as feeRecipient on the factory, registers reward tokens,
 * then updates deployments/baseSepolia-84532.json and subgraph/subgraph.yaml.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-vault.cjs --network baseSepolia
 */
const fs   = require("fs");
const path = require("path");
const hre  = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployments", "baseSepolia-84532.json");
const SUBGRAPH_YAML   = path.join(__dirname, "..", "subgraph", "subgraph.yaml");

const EPOCH_DURATION = BigInt(process.env.VAULT_EPOCH_DURATION || "604800"); // 7 days
const LOCK_DURATION  = BigInt(process.env.VAULT_LOCK_DURATION  || "604800"); // 7 days
const INITIAL_MINT   = BigInt(process.env.AFTR_INITIAL_MINT    || String(100_000_000n * 10n ** 18n));

async function deployAndTrack(factory, ...args) {
  const instance = await factory.deploy(...args);
  const receipt  = await instance.deploymentTransaction().wait();
  const address  = await instance.getAddress();
  return { instance, address, blockNumber: receipt.blockNumber };
}

function patchYaml(yaml, name, address, startBlock) {
  const addrRe  = new RegExp(`(name:\\s*${name}[\\s\\S]*?source:[\\s\\S]*?address:\\s*")[^"]*(")`);
  const blockRe = new RegExp(`(name:\\s*${name}[\\s\\S]*?source:[\\s\\S]*?startBlock:\\s*)\\d+`);
  yaml = yaml.replace(addrRe,  `$1${address}$2`);
  yaml = yaml.replace(blockRe, `$1${startBlock}`);
  return yaml;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error("Deployment file not found — run deploy-aftr-full-stack.cjs first.");
  }
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const factoryAddress = dep.contracts?.AFTRParimutuelMarketFactory;
  if (!factoryAddress) throw new Error("AFTRParimutuelMarketFactory not found in deployment JSON.");

  const aftrUsdcAddr         = dep.contracts?.AFTRUSDC;
  const usdeadAddr           = dep.contracts?.USDeAD;
  const circleUsdcAddr       = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const deploymentBlocks     = dep.deploymentBlocks ?? {};

  // ── 1. AFTRToken ────────────────────────────────────────────────────────────
  console.log("\n[1/3] Deploying AFTRToken...");
  const AFTRTokenF = await hre.ethers.getContractFactory("AFTRToken");
  const { address: aftrTokenAddr, blockNumber: aftrTokenBlock } =
    await deployAndTrack(AFTRTokenF, deployer.address, INITIAL_MINT);
  deploymentBlocks.AFTRToken = aftrTokenBlock;
  console.log(`  AFTRToken: ${aftrTokenAddr}  (block ${aftrTokenBlock})`);
  console.log(`  Minted ${(INITIAL_MINT / 10n ** 18n).toLocaleString()} AFTR to deployer`);

  // ── 2. AFTRFeeVault ─────────────────────────────────────────────────────────
  console.log("\n[2/3] Deploying AFTRFeeVault...");
  const VaultF = await hre.ethers.getContractFactory("AFTRFeeVault");
  const { instance: vault, address: vaultAddr, blockNumber: vaultBlock } =
    await deployAndTrack(VaultF, deployer.address, aftrTokenAddr, EPOCH_DURATION, LOCK_DURATION);
  deploymentBlocks.AFTRFeeVault = vaultBlock;
  console.log(`  AFTRFeeVault: ${vaultAddr}  (block ${vaultBlock})`);

  // ── 3. Wire vault into existing factory ─────────────────────────────────────
  console.log("\n[3/3] Wiring vault into factory...");
  const factory = await hre.ethers.getContractAt(
    ["function setFeeRecipient(address) external",
     "function addSupportedCollateral(address) external",
     "function isSupportedCollateral(address) view returns (bool)"],
    factoryAddress
  );

  await (await factory.setFeeRecipient(vaultAddr)).wait();
  console.log(`  factory.feeRecipient → ${vaultAddr}`);

  // Register reward tokens on vault
  const rewardTokens = [
    { addr: aftrUsdcAddr,   label: "AFTRUSDC"     },
    { addr: usdeadAddr,     label: "USDeAD"        },
    { addr: circleUsdcAddr, label: "Circle USDC"   },
    { addr: hre.ethers.ZeroAddress, label: "ETH"   },
  ].filter(t => t.addr);

  for (const { addr, label } of rewardTokens) {
    await (await vault.addRewardToken(addr)).wait();
    console.log(`  vault.addRewardToken(${label})`);
  }

  // ── Update deployment JSON ───────────────────────────────────────────────────
  dep.contracts.AFTRToken    = aftrTokenAddr;
  dep.contracts.AFTRFeeVault = vaultAddr;
  dep.feeRecipient           = vaultAddr;
  dep.deploymentBlocks       = deploymentBlocks;
  dep.vault = {
    stakeToken:    aftrTokenAddr,
    epochDuration: EPOCH_DURATION.toString(),
    lockDuration:  LOCK_DURATION.toString(),
    rewardTokens:  rewardTokens.map(t => t.addr),
  };
  dep.deployedAt = new Date().toISOString();

  fs.writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(dep, null, 2)}\n`, "utf8");
  console.log("\nUpdated deployment JSON:", DEPLOYMENT_FILE);

  // ── Update subgraph.yaml ─────────────────────────────────────────────────────
  let yaml = fs.readFileSync(SUBGRAPH_YAML, "utf8");
  yaml = patchYaml(yaml, "Vault", vaultAddr, vaultBlock);
  fs.writeFileSync(SUBGRAPH_YAML, yaml, "utf8");
  console.log("Updated subgraph/subgraph.yaml:");
  console.log(`  Vault → ${vaultAddr}  startBlock: ${vaultBlock}`);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Vault deployment complete:");
  console.log(`  AFTRToken:    ${aftrTokenAddr}`);
  console.log(`  AFTRFeeVault: ${vaultAddr}`);
  console.log(`  feeRecipient on factory updated to vault`);
  console.log("\nNext: run subgraph codegen + build + deploy");
  console.log("  npm run subgraph:codegen");
  console.log("  npm run subgraph:build");
  console.log("  npm run subgraph:deploy-studio");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });

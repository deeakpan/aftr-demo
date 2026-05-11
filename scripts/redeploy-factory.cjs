/**
 * redeploy-factory.cjs
 *
 * Redeploys AFTRParimutuelMarketFactory + AFTRParimutuelDeployer + AFTROrderBook + AFTRMarketDebtRouter
 * with all the new changes (creator fees, atomic seed, 1.5% fee, approveDrp, etc.)
 *
 * Reuses existing: AFTRToken, AFTRFeeVault, AFTRUSDC, USDeAD, DRP
 *
 * Usage:
 *   npx hardhat run scripts/redeploy-factory.cjs --network baseSepolia
 */
const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const hre  = require("hardhat");
const { deployParimutuelFacade } = require("./lib/deploy-parimutuel-facade.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployments", "baseSepolia-84532.json");

const OOv2_BASE_SEPOLIA    = "0x99EC530a761E68a377593888D9504002Bd191717";
const CIRCLE_USDC          = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function deployAndTrack(factory, ...args) {
  const instance = await factory.deploy(...args);
  const receipt  = await instance.deploymentTransaction().wait();
  const address  = await instance.getAddress();
  return { instance, address, blockNumber: receipt.blockNumber };
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const blocks = dep.deploymentBlocks ?? {};

  // Reuse these — already deployed and correct
  const vaultAddr    = dep.contracts.AFTRFeeVault;
  const drpAddress   = dep.contracts.DRP;
  const aftrUsdcAddr = dep.contracts.AFTRUSDC;
  const usdeadAddr   = dep.contracts.USDeAD;

  console.log("\nReusing:");
  console.log("  AFTRFeeVault:", vaultAddr);
  console.log("  DRP:         ", drpAddress);

  // ── 1. Factory (feeRecipient = vault) ──────────────────────────────────────
  console.log("\n[1/4] Deploying AFTRParimutuelMarketFactory...");
  const FactoryF = await hre.ethers.getContractFactory("AFTRParimutuelMarketFactory");
  const { instance: factory, address: factoryAddress, blockNumber: factoryBlock } =
    await deployAndTrack(FactoryF, deployer.address, vaultAddr, OOv2_BASE_SEPOLIA, CIRCLE_USDC);
  blocks.AFTRParimutuelMarketFactory = factoryBlock;
  console.log(`  Factory: ${factoryAddress}  (block ${factoryBlock})`);
  console.log(`  feeRecipient = vault (${vaultAddr})`);

  // ── 2. Deployer lib (3 txs — EIP-3860) ─────────────────────────────────────
  console.log("\n[2/4] Deploying AFTRParimutuelDeployer + sub-deployers...");
  const {
    marketDeployerAddress: deployerAddress,
    facadeBlock: deployerBlock,
    priceDep,
    eventDep,
    priceBlock,
    eventBlock,
  } = await deployParimutuelFacade(hre, deployer, factoryAddress, deployAndTrack);
  blocks.AFTRParimutuelDeployer = deployerBlock;
  blocks.AFTRPriceMarketDeployer = priceBlock;
  blocks.AFTREventMarketDeployer = eventBlock;
  console.log(`  Price deployer:  ${priceDep}  (block ${priceBlock})`);
  console.log(`  Event deployer:  ${eventDep}  (block ${eventBlock})`);
  console.log(`  Facade:          ${deployerAddress}  (block ${deployerBlock})`);

  // Wire deployer into factory
  await (await factory.setMarketDeployer(deployerAddress)).wait();
  console.log("  factory.setMarketDeployer ✓");

  // Register collaterals
  await (await factory.addSupportedCollateral(aftrUsdcAddr)).wait();
  await (await factory.addSupportedCollateral(usdeadAddr)).wait();
  await (await factory.addSupportedCollateral(CIRCLE_USDC)).wait();
  console.log("  Collaterals registered: AFTRUSDC, USDeAD, Circle USDC ✓");

  // ── 3. OrderBook ───────────────────────────────────────────────────────────
  console.log("\n[3/4] Deploying AFTROrderBook...");
  const OrderBookF = await hre.ethers.getContractFactory("AFTROrderBook");
  const { address: orderBookAddress, blockNumber: orderBookBlock } =
    await deployAndTrack(OrderBookF, factoryAddress, deployer.address, deployer.address);
  blocks.AFTROrderBook = orderBookBlock;
  console.log(`  OrderBook: ${orderBookAddress}  (block ${orderBookBlock})`);

  // ── 4. Router ──────────────────────────────────────────────────────────────
  console.log("\n[4/4] Deploying AFTRMarketDebtRouter...");
  const RouterF = await hre.ethers.getContractFactory("AFTRMarketDebtRouter");
  const { instance: router, address: routerAddress, blockNumber: routerBlock } =
    await deployAndTrack(RouterF, factoryAddress, drpAddress);
  blocks.AFTRMarketDebtRouter = routerBlock;
  console.log(`  Router: ${routerAddress}  (block ${routerBlock})`);

  // ── Whitelist router on DRP ────────────────────────────────────────────────
  console.log("\nWhitelisting router on DRP...");
  const TIMELOCK_OP_SET_VAULT_MANAGER = 2;
  try {
    const drp = await hre.ethers.getContractAt(
      ["function trustedManagers(address) view returns (bool)",
       "function schedule(uint8,address,uint256) external",
       "function executeOp(uint8) external"],
      drpAddress
    );
    const trusted = await drp.trustedManagers(routerAddress);
    if (!trusted) {
      await (await drp.schedule(TIMELOCK_OP_SET_VAULT_MANAGER, routerAddress, 1)).wait();
      await new Promise(r => setTimeout(r, 4500));
      await (await drp.executeOp(TIMELOCK_OP_SET_VAULT_MANAGER)).wait();
      console.log("  Router whitelisted on DRP ✓");
    } else {
      console.log("  Router already trusted on DRP");
    }
  } catch (e) {
    console.warn("  DRP whitelist failed (run drp:enable-router-manager manually):", e?.shortMessage ?? e?.message);
  }

  // ── Update deployment JSON ─────────────────────────────────────────────────
  dep.contracts.AFTRParimutuelMarketFactory = factoryAddress;
  dep.contracts.AFTRParimutuelDeployer      = deployerAddress;
  dep.contracts.AFTROrderBook               = orderBookAddress;
  dep.contracts.AFTRMarketDebtRouter        = routerAddress;
  dep.feeRecipient                          = vaultAddr;
  dep.deploymentBlocks                      = blocks;
  dep.deployedAt                            = new Date().toISOString();

  fs.writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(dep, null, 2)}\n`, "utf8");
  console.log("\nUpdated deployment JSON ✓");

  // ── Update subgraph.yaml from deployment JSON (Factory, Router, Vault) ───
  try {
    execSync("node scripts/subgraph-update-config.cjs", { cwd: path.join(__dirname, ".."), stdio: "inherit" });
    console.log("Updated subgraph/subgraph.yaml ✓");
  } catch (e) {
    console.warn("subgraph-update-config failed:", e?.message ?? e);
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Redeploy complete. New addresses:");
  console.log(`  Factory:  ${factoryAddress}`);
  console.log(`  Deployer: ${deployerAddress}`);
  console.log(`  OrderBook:${orderBookAddress}`);
  console.log(`  Router:   ${routerAddress}`);
  console.log("\nNext: rebuild + redeploy subgraph");
  console.log("  npm run subgraph:codegen && npm run subgraph:build");
  console.log("  SUBGRAPH_VERSION_LABEL=v0.07 npm run subgraph:deploy-studio");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });

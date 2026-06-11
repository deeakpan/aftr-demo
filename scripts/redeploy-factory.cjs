/**
 * redeploy-factory.cjs
 *
 * Redeploys MondaloreParimutuelMarketFactory + MondaloreParimutuelDeployer + MondaloreOrderBook.
 *
 * Reuses existing: MondaloreToken, MondaloreFeeVault, MondaloreUSDC
 *
 * Usage:
 *   npx hardhat run scripts/redeploy-factory.cjs --network monadTestnet
 */
const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const hre  = require("hardhat");
const { deployParimutuelFacade } = require("./lib/deploy-parimutuel-facade.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployments", "monadTestnet-10143.json");

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
  const vaultAddr    = dep.contracts.MondaloreFeeVault;
  const aftrUsdcAddr = dep.contracts.MondaloreUSDC;
  const wethAddr     = dep.contracts.MockWETH;

  console.log("\nReusing:");
  console.log("  MondaloreFeeVault:", vaultAddr);

  // ── 1. Factory (feeRecipient = vault) ──────────────────────────────────────
  console.log("\n[1/3] Deploying MondaloreParimutuelMarketFactory...");
  const FactoryF = await hre.ethers.getContractFactory("MondaloreParimutuelMarketFactory");
  const { instance: factory, address: factoryAddress, blockNumber: factoryBlock } =
    await deployAndTrack(FactoryF, deployer.address, vaultAddr, OOv2_BASE_SEPOLIA, CIRCLE_USDC);
  blocks.MondaloreParimutuelMarketFactory = factoryBlock;
  console.log(`  Factory: ${factoryAddress}  (block ${factoryBlock})`);
  console.log(`  feeRecipient = vault (${vaultAddr})`);

  // ── 2. Deployer lib (3 txs — EIP-3860) ─────────────────────────────────────
  console.log("\n[2/3] Deploying MondaloreParimutuelDeployer + sub-deployers...");
  const {
    marketDeployerAddress: deployerAddress,
    facadeBlock: deployerBlock,
    priceDep,
    eventDep,
    priceBlock,
    eventBlock,
  } = await deployParimutuelFacade(hre, deployer, factoryAddress, deployAndTrack);
  blocks.MondaloreParimutuelDeployer = deployerBlock;
  blocks.MondalorePriceMarketDeployer = priceBlock;
  blocks.MondaloreEventMarketDeployer = eventBlock;
  console.log(`  Price deployer:  ${priceDep}  (block ${priceBlock})`);
  console.log(`  Event deployer:  ${eventDep}  (block ${eventBlock})`);
  console.log(`  Facade:          ${deployerAddress}  (block ${deployerBlock})`);

  // Wire deployer into factory
  await (await factory.setMarketDeployer(deployerAddress)).wait();
  console.log("  factory.setMarketDeployer ✓");

  // Register collaterals
  await (await factory.addSupportedCollateral(aftrUsdcAddr)).wait();
  if (wethAddr) await (await factory.addSupportedCollateral(wethAddr)).wait();
  await (await factory.addSupportedCollateral(CIRCLE_USDC)).wait();
  if (wethAddr) {
    await (await factory.setWrappedNativeToken(wethAddr)).wait();
    await (await factory.addSupportedCollateral(hre.ethers.ZeroAddress)).wait();
    console.log(`  wrappedNativeToken = ${wethAddr}, native MON (address(0)) enabled ✓`);
  }
  console.log("  Collaterals registered: MondaloreUSDC, WETH (if set), Circle USDC ✓");

  const mockBtcFeed = dep.contracts?.MockBtcUsdFeed;
  if (mockBtcFeed) {
    const btcKey = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("BTC"));
    await (await factory.setPriceFeed(btcKey, mockBtcFeed)).wait();
    console.log(`  priceFeeds[BTC] = ${mockBtcFeed} ✓`);
  } else {
    console.warn("  MockBtcUsdFeed not in deployment — run deploy:mock-btc-feed then set-price-feeds");
  }

  const resolutionAdmins = (dep.resolutionAdmins ?? []).filter(
    (a) => typeof a === "string" && hre.ethers.isAddress(a),
  );
  if (resolutionAdmins.length >= 3) {
    await (await factory.setResolutionAdmins(resolutionAdmins)).wait();
    console.log(`  resolutionAdmins (${resolutionAdmins.length}) ✓`);
  } else {
    console.warn("  resolutionAdmins not set — event markets will revert until set-resolution-admins runs");
  }

  // ── 3. OrderBook ───────────────────────────────────────────────────────────
  console.log("\n[3/3] Deploying MondaloreOrderBook...");
  const OrderBookF = await hre.ethers.getContractFactory("MondaloreOrderBook");
  const { address: orderBookAddress, blockNumber: orderBookBlock } =
    await deployAndTrack(OrderBookF, factoryAddress, deployer.address, deployer.address);
  blocks.MondaloreOrderBook = orderBookBlock;
  console.log(`  OrderBook: ${orderBookAddress}  (block ${orderBookBlock})`);

  // ── Update deployment JSON ─────────────────────────────────────────────────
  dep.contracts.MondaloreParimutuelMarketFactory = factoryAddress;
  dep.contracts.MondaloreParimutuelDeployer      = deployerAddress;
  dep.contracts.MondaloreOrderBook               = orderBookAddress;
  delete dep.contracts.MondaloreMarketDebtRouter;
  delete dep.contracts.DRP;
  delete dep.contracts.USDeAD;
  dep.feeRecipient                          = vaultAddr;
  dep.deploymentBlocks                      = blocks;
  dep.deployedAt                            = new Date().toISOString();

  fs.writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(dep, null, 2)}\n`, "utf8");
  console.log("\nUpdated deployment JSON ✓");

  const factoryArtifact = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "factory",
    "MondaloreParimutuelMarketFactory.sol",
    "MondaloreParimutuelMarketFactory.json",
  );
  const subgraphFactoryAbi = path.join(__dirname, "..", "subgraph", "abis", "Factory.json");
  if (fs.existsSync(factoryArtifact)) {
    fs.copyFileSync(factoryArtifact, subgraphFactoryAbi);
    console.log("Copied Factory ABI → subgraph/abis/Factory.json ✓");
  }

  // ── Update subgraph.yaml from deployment JSON (Factory, Vault) ───
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
  console.log("\nNext: rebuild + redeploy subgraph");
  console.log("  npm run subgraph:codegen && npm run subgraph:build");
  console.log("  SUBGRAPH_VERSION_LABEL=v0.07 npm run subgraph:deploy-studio");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });

/**
 * Deploy Zedkr FPMM stack: CollateralRegistry + FPMM Factory + Deployer.
 * Registers Chainlink feeds, resolution admins, and whitelists collateral (USDG on Robinhood).
 */
const { registerPriceFeedsOnFactory } = require("./register-price-feeds.cjs");

/**
 * @param {import("hardhat").HardhatRuntimeEnvironment} hre
 * @param {import("ethers").Signer} deployer
 * @param {string} feeRecipient vault or EOA
 * @param {{ deployAndTrack: Function, chainlinkFeeds?: object[], collateralTokens?: string[], resolutionAdmins?: string[], ponsResolutionAdmin?: string, deploymentBlocks?: object }} opts
 */
async function deployFpmmStack(hre, deployer, feeRecipient, opts) {
  const { deployAndTrack } = opts;
  const deploymentBlocks = opts.deploymentBlocks ?? {};

  console.log("\n[FPMM] Deploying ZedkrCollateralRegistry...");
  const RegistryF = await hre.ethers.getContractFactory("ZedkrCollateralRegistry");
  const { instance: registry, address: registryAddr, blockNumber: registryBlock } =
    await deployAndTrack(RegistryF, deployer.address);
  deploymentBlocks.ZedkrCollateralRegistry = registryBlock;
  console.log(`  ZedkrCollateralRegistry: ${registryAddr} (block ${registryBlock})`);

  console.log("[FPMM] Deploying ZedkrFpmmMarketFactory...");
  const FactoryF = await hre.ethers.getContractFactory("ZedkrFpmmMarketFactory");
  const { instance: fpmmFactory, address: fpmmFactoryAddr, blockNumber: fpmmFactoryBlock } =
    await deployAndTrack(FactoryF, deployer.address, feeRecipient, registryAddr);
  deploymentBlocks.ZedkrFpmmMarketFactory = fpmmFactoryBlock;
  console.log(`  ZedkrFpmmMarketFactory: ${fpmmFactoryAddr} (block ${fpmmFactoryBlock})`);

  console.log("[FPMM] Deploying ZedkrFpmmDeployer...");
  const DeployerF = await hre.ethers.getContractFactory("ZedkrFpmmDeployer");
  const { address: fpmmDeployerAddr, blockNumber: fpmmDeployerBlock } =
    await deployAndTrack(DeployerF, fpmmFactoryAddr);
  deploymentBlocks.ZedkrFpmmDeployer = fpmmDeployerBlock;
  console.log(`  ZedkrFpmmDeployer: ${fpmmDeployerAddr} (block ${fpmmDeployerBlock})`);

  await (await fpmmFactory.setMarketDeployer(fpmmDeployerAddr)).wait();
  console.log("  Linked fpmmFactory.marketDeployer");

  const admins = opts.resolutionAdmins ?? [];
  if (admins.length >= 3) {
    await (await fpmmFactory.setResolutionAdmins(admins)).wait();
    console.log(`  FPMM resolution admins (${admins.length}):`, admins.join(", "));
  } else if (admins.length > 0) {
    console.warn("  FPMM: fewer than 3 resolution admins — event markets blocked until setResolutionAdmins");
  }

  const ponsAdmin = opts.ponsResolutionAdmin ?? deployer.address;
  await (await fpmmFactory.setPonsResolutionAdmin(ponsAdmin)).wait();
  console.log(`  FPMM ponsResolutionAdmin: ${ponsAdmin}`);

  const feeds = opts.chainlinkFeeds ?? [];
  if (feeds.length > 0) {
    console.log(`  Registering ${feeds.length} Chainlink feed(s) on FPMM factory…`);
    await registerPriceFeedsOnFactory(fpmmFactory, feeds, hre.ethers);
  }

  const tokens = opts.collateralTokens ?? [];
  for (const token of tokens) {
    if (!token || token === hre.ethers.ZeroAddress) continue;
    await (await registry.whitelistCollateral(token)).wait();
    console.log(`  Whitelisted collateral: ${token}`);
  }

  return {
    registry: registryAddr,
    fpmmFactory: fpmmFactoryAddr,
    fpmmDeployer: fpmmDeployerAddr,
    deploymentBlocks,
  };
}

module.exports = { deployFpmmStack };

/* eslint-disable no-console */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const defaultAdmin = process.env.DRP_DEFAULT_ADMIN?.trim() || deployer.address;
  const paramSetterAdmin =
    process.env.DRP_PARAM_SETTER_ADMIN?.trim() || deployer.address;
  const canonicalWeth = "0x4200000000000000000000000000000000000006";
  const defaultEthFeed = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1";

  const weth = process.env.DRP_WETH?.trim() || canonicalWeth;
  const reth = process.env.DRP_RETH?.trim() || weth;
  const wstETH = process.env.DRP_WSTETH?.trim() || weth;
  const wethFeed = process.env.DRP_WETH_FEED?.trim() || defaultEthFeed;
  const rethFeed = process.env.DRP_RETH_FEED?.trim() || defaultEthFeed;
  const wstETHFeed = process.env.DRP_WSTETH_FEED?.trim() || defaultEthFeed;
  const distro = process.env.DRP_DISTRO?.trim() || deployer.address;
  const vaultDistributor =
    process.env.DRP_VAULT_DISTRIBUTOR?.trim() || deployer.address;

  const USDeAD = await hre.ethers.getContractFactory("USDeAD");
  const usdead = await USDeAD.deploy(defaultAdmin);
  await usdead.waitForDeployment();
  const usdeadAddress = await usdead.getAddress();
  console.log("USDeAD:", usdeadAddress);

  let treasury = process.env.DRP_TREASURY?.trim();
  if (!treasury) {
    const Treasury = await hre.ethers.getContractFactory("MockTreasurySplitter");
    const treasuryContract = await Treasury.deploy();
    await treasuryContract.waitForDeployment();
    treasury = await treasuryContract.getAddress();
    console.log("MockTreasurySplitter:", treasury);
  }

  let stabilityPool = process.env.DRP_STABILITY_POOL?.trim();
  if (!stabilityPool) {
    const SP = await hre.ethers.getContractFactory("MockStabilityPool");
    const sp = await SP.deploy(
      usdeadAddress,
      weth,
      reth,
      wstETH,
      defaultAdmin,
    );
    await sp.waitForDeployment();
    stabilityPool = await sp.getAddress();
    console.log("MockStabilityPool:", stabilityPool);
  }

  const DRP = await hre.ethers.getContractFactory("DeaderalReserveProtocol");
  const drp = await DRP.deploy({
    weth,
    reth,
    wstETH,
    wethFeed,
    rethFeed,
    wstETHFeed,
    usdead: usdeadAddress,
    treasury,
    distro,
    stabilityPool,
    vaultDistributor,
    defaultAdmin,
    paramSetterAdmin,
  });
  await drp.waitForDeployment();
  const drpAddress = await drp.getAddress();
  console.log("DeaderalReserveProtocol:", drpAddress);

  const sp = await hre.ethers.getContractAt("MockStabilityPool", stabilityPool);
  try {
    await (await sp.setDRP(drpAddress)).wait();
    console.log("Linked StabilityPool -> DRP");
  } catch {
    console.log("Skipped setDRP (likely already set or non-mock SP)");
  }

  // Design intent from DRP comments: token ownership should move to DRP.
  if (defaultAdmin.toLowerCase() === deployer.address.toLowerCase()) {
    await (await usdead.transferOwnership(drpAddress)).wait();
    console.log("Transferred USDeAD ownership to DRP");
  } else {
    console.log(
      "Skipped ownership transfer (DRP_DEFAULT_ADMIN != deployer). Transfer manually:",
      `USDeAD.transferOwnership(${drpAddress})`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * One-shot: whitelist MockWETH on the new collateral registry + set platformDev for surplus.
 */
const path = require("path");
const fs = require("fs");
const hre = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const depPath = path.join(__dirname, "..", "deployments", `${hre.network.name}-${chainId}.json`);
  const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));

  const registry = await hre.ethers.getContractAt(
    "ZedkrCollateralRegistry",
    dep.contracts.ZedkrCollateralRegistry,
    signer,
  );
  const factory = await hre.ethers.getContractAt(
    "ZedkrFpmmMarketFactory",
    dep.contracts.ZedkrFpmmMarketFactory,
    signer,
  );

  const weth = dep.contracts.MockWETH || dep.contracts.WETH;
  if (weth) {
    try {
      await (await registry.whitelistCollateral(weth)).wait();
      console.log("Whitelisted MockWETH:", weth);
    } catch (e) {
      console.log("MockWETH whitelist skipped:", e instanceof Error ? e.message : e);
    }
  }

  // Surplus pull recipient = platformDev (falls back to treasury/vault if unset).
  const platform = process.env.PLATFORM_DEV?.trim() || signer.address;
  const distribution = process.env.DISTRIBUTION?.trim() || hre.ethers.ZeroAddress;
  const treasury = dep.feeRecipient || (await factory.treasury());
  await (await factory.setFeeSplit(platform, distribution, treasury)).wait();
  console.log("Fee split:", { platformDev: platform, distribution, treasury });

  // Keep token resolution admin = deployer (resolver bot wallet).
  const admin = process.env.TOKEN_RESOLUTION_ADMIN?.trim() || signer.address;
  await (await factory.setTokenResolutionAdmin(admin)).wait();
  console.log("tokenResolutionAdmin:", admin);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

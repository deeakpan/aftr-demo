/* eslint-disable no-console */
/**
 * Deploy Zedkr FPMM stack only (registry + factory + deployer).
 * Merges into existing deployments/{network}-{chainId}.json.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-zedkr-fpmm-stack.cjs --network robinhoodMainnet
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { deployFpmmStack } = require("./lib/deploy-fpmm-stack.cjs");
const { registerPriceFeedsOnFactory } = require("./lib/register-price-feeds.cjs");
const { robinhoodNetworkExternals } = require("./lib/robinhood-chainlink-feeds.cjs");
const { WALLETS_PATH } = require("./lib/aftr-scripts-lib.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function deployAndTrack(factory, ...args) {
  const instance = await factory.deploy(...args);
  const receipt = await instance.deploymentTransaction().wait();
  return { instance, address: await instance.getAddress(), blockNumber: receipt.blockNumber };
}

function loadResolutionAdmins(deployerAddress) {
  if (process.env.RESOLUTION_ADMINS?.trim()) {
    return process.env.RESOLUTION_ADMINS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (fs.existsSync(WALLETS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
      const addrs = (data.wallets ?? []).slice(0, 4).map((w) => w.address).filter(Boolean);
      if (addrs.length >= 3) return addrs;
    } catch {
      // ignore
    }
  }
  return [deployerAddress];
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const depPath = path.join(__dirname, "..", "deployments", `${hre.network.name}-${chainId}.json`);
  if (!fs.existsSync(depPath)) {
    throw new Error(`Missing deployment file: ${depPath}. Run deploy-aftr-full-stack first for vault/feeRecipient.`);
  }
  const prev = JSON.parse(fs.readFileSync(depPath, "utf8"));
  const feeRecipient = prev.feeRecipient;
  if (!feeRecipient || /^0x0+$/i.test(feeRecipient)) {
    throw new Error("feeRecipient missing in deployment JSON");
  }

  // Prefer mintable mock from full-stack deploy (contracts.USDG). Real Robinhood USDG is only for Pons pairs.
  const usdg =
    process.env.USDG_ADDRESS?.trim() ||
    prev.contracts?.USDG?.trim() ||
    (process.env.USE_REAL_USDG === "1"
      ? process.env.ROBINHOOD_USDG?.trim() ||
        prev.external?.pons?.usdg ||
        (chainId === 4663 ? robinhoodNetworkExternals().usdg : null)
      : null);

  const collaterals = [prev.contracts?.MondaloreUSDC].filter(Boolean);
  if (usdg) collaterals.push(usdg);
  else if (!prev.contracts?.USDG) {
    console.warn(
      "No contracts.USDG yet — deploy mintable USDG via full stack (or scripts/deploy-usdg.cjs) before FPMM-only.",
    );
  }

  const chainlinkFeeds = prev.external?.chainlinkFeeds ?? (chainId === 4663 ? robinhoodNetworkExternals().chainlinkFeeds : []);

  const deploymentBlocks = { ...(prev.deploymentBlocks ?? {}) };
  const result = await deployFpmmStack(hre, deployer, feeRecipient, {
    deployAndTrack,
    deploymentBlocks,
    chainlinkFeeds,
    collateralTokens: collaterals,
    resolutionAdmins: prev.resolutionAdmins?.length >= 3 ? prev.resolutionAdmins : loadResolutionAdmins(deployer.address),
    ponsResolutionAdmin:
      process.env.PONS_RESOLUTION_ADMIN?.trim() ||
      process.env.NAD_RESOLUTION_ADMIN?.trim() ||
      prev.nadResolutionAdmin ||
      deployer.address,
  });

  const payload = {
    ...prev,
    contracts: {
      ...prev.contracts,
      ZedkrCollateralRegistry: result.registry,
      ZedkrFpmmMarketFactory: result.fpmmFactory,
      ZedkrFpmmDeployer: result.fpmmDeployer,
    },
    deploymentBlocks: result.deploymentBlocks,
    notes: {
      ...(prev.notes ?? {}),
      primaryMarketFactory: "ZedkrFpmmMarketFactory",
      fpmmCollaterals: collaterals,
    },
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(depPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("\nWrote:", depPath);
  console.log("  ZedkrFpmmMarketFactory:", result.fpmmFactory);
  console.log("  ZedkrCollateralRegistry:", result.registry);
  console.log("  Whitelisted:", collaterals.join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

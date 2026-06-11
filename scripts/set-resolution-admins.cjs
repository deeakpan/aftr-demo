/* eslint-disable no-console */
/**
 * Set factory resolution admins from RESOLUTION_ADMINS env or first 4 wallets in wallets.json.
 *
 *   npx hardhat run scripts/set-resolution-admins.cjs --network monadTestnet
 */
const path = require("path");
const hre = require("hardhat");
const { readDeployment, WALLETS_PATH } = require("./lib/aftr-scripts-lib.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const FACTORY_ABI = [
  "function setResolutionAdmins(address[] admins)",
  "function resolutionAdminsLength() view returns (uint256)",
];

function loadAdmins(deployer) {
  if (process.env.RESOLUTION_ADMINS?.trim()) {
    return process.env.RESOLUTION_ADMINS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const fs = require("fs");
  if (fs.existsSync(WALLETS_PATH)) {
    const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
    const addrs = (data.wallets ?? []).slice(0, 4).map((w) => w.address).filter(Boolean);
    if (addrs.length >= 3) return addrs;
  }
  return [deployer];
}

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const deployment = readDeployment();
  const factoryAddress = deployment.contracts.MondaloreParimutuelMarketFactory;
  if (!factoryAddress) throw new Error("Factory missing in deployment JSON");

  const admins = loadAdmins(signer.address);
  if (admins.length < 3) {
    throw new Error(`Need at least 3 admins, got ${admins.length}`);
  }

  console.log("Factory:", factoryAddress);
  console.log("Setting resolution admins (3-of-10):", admins.join(", "));

  const factory = new hre.ethers.Contract(factoryAddress, FACTORY_ABI, signer);
  const tx = await factory.setResolutionAdmins(admins);
  await tx.wait();

  const len = await factory.resolutionAdminsLength();
  console.log("Done. resolutionAdminsLength =", len.toString());
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

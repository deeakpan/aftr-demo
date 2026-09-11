/* eslint-disable no-console */
/**
 * Set factory resolution admins from:
 *   1) RESOLUTION_ADMINS env (comma-separated), or
 *   2) wallets.json resolutionAdmins / deployer + wallets, or
 *   3) deployer only (fails if < 3)
 *
 *   npx hardhat run scripts/set-resolution-admins.cjs --network unichainSepolia
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const WALLETS_PATH = path.join(__dirname, "..", "wallets.json");

const FACTORY_ABI = [
  "function setResolutionAdmins(address[] admins)",
  "function resolutionAdmins(uint256 index) view returns (address)",
  "function resolutionThreshold() view returns (uint256)",
];

const DEPLOYMENT_BY_CHAIN = {
  1301: "unichainSepolia-1301.json",
  10143: "monadTestnet-10143.json",
  4663: "robinhoodMainnet-4663.json",
};

function readDeploymentForChain(chainId) {
  const file = DEPLOYMENT_BY_CHAIN[chainId];
  if (!file) throw new Error(`No deployment mapping for chainId ${chainId}`);
  const p = path.join(__dirname, "..", "deployments", file);
  if (!fs.existsSync(p)) throw new Error(`Missing deployment file: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadAdmins(deployer) {
  if (process.env.RESOLUTION_ADMINS?.trim()) {
    return process.env.RESOLUTION_ADMINS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (fs.existsSync(WALLETS_PATH)) {
    const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
    if (Array.isArray(data.resolutionAdmins) && data.resolutionAdmins.length >= 3) {
      return data.resolutionAdmins.map((a) => String(a).trim()).filter(Boolean);
    }
    const addrs = (data.wallets ?? []).map((w) => w.address).filter(Boolean);
    const merged = [deployer, ...addrs].filter((a, i, arr) => {
      const lower = String(a).toLowerCase();
      return arr.findIndex((x) => String(x).toLowerCase() === lower) === i;
    });
    if (merged.length >= 3) return merged.slice(0, 10);
  }
  return [deployer];
}

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const chainId = Number(hre.network.config.chainId);
  const deployment = readDeploymentForChain(chainId);
  const factoryAddress =
    deployment.contracts?.ZedkrFpmmMarketFactory ||
    deployment.contracts?.FpmmMarketFactory;
  if (!factoryAddress) throw new Error("ZedkrFpmmMarketFactory missing in deployment JSON");

  const admins = loadAdmins(signer.address);
  if (admins.length < 3) {
    throw new Error(`Need at least 3 admins, got ${admins.length}. Generate wallets.json first.`);
  }

  console.log("Network:", hre.network.name, `(${chainId})`);
  console.log("Factory:", factoryAddress);
  console.log("Setting resolution admins (3-of-N):", admins.join(", "));

  const factory = new hre.ethers.Contract(factoryAddress, FACTORY_ABI, signer);
  const tx = await factory.setResolutionAdmins(admins);
  console.log("tx:", tx.hash);
  await tx.wait();

  const threshold = await factory.resolutionThreshold();
  console.log("Done. resolutionThreshold =", threshold.toString());
  for (let i = 0; i < admins.length; i += 1) {
    try {
      const a = await factory.resolutionAdmins(i);
      console.log(`  admin[${i}]:`, a);
    } catch {
      break;
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

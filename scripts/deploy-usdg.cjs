/* eslint-disable no-console */
/**
 * Deploy USDG and merge address into deployments/{network}-{chainId}.json.
 * Whitelists on ZedkrCollateralRegistry when deployed.
 *
 * Env:
 *   USDG_EXTRA_MINT — human amount minted to deployer after deploy (default 1_000_000)
 *   USDG_MINT_TO — optional extra recipient
 *   USDG_MINT_AMOUNT — human amount for USDG_MINT_TO (default 10_000)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-usdg.cjs --network monadTestnet
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function deployAndTrack(factory, ...args) {
  const instance = await factory.deploy(...args);
  const receipt = await instance.deploymentTransaction().wait();
  return { instance, address: await instance.getAddress(), blockNumber: receipt.blockNumber };
}

function mergeDeployment(chainId, networkName, patch) {
  const depPath = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  let prev = {};
  if (fs.existsSync(depPath)) {
    try {
      prev = JSON.parse(fs.readFileSync(depPath, "utf8"));
    } catch {
      // ignore
    }
  }
  const payload = {
    ...prev,
    ...patch,
    network: networkName,
    chainId,
    deployedAt: new Date().toISOString(),
    contracts: { ...(prev.contracts ?? {}), ...(patch.contracts ?? {}) },
    deploymentBlocks: { ...(prev.deploymentBlocks ?? {}), ...(patch.deploymentBlocks ?? {}) },
    external: {
      ...(prev.external ?? {}),
      ...(patch.external ?? {}),
      pons: { ...(prev.external?.pons ?? {}), ...(patch.external?.pons ?? {}) },
    },
  };
  fs.mkdirSync(path.dirname(depPath), { recursive: true });
  fs.writeFileSync(depPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return depPath;
}

async function maybeWhitelist(registryAddr, tokenAddr, deployer) {
  if (!registryAddr || registryAddr === hre.ethers.ZeroAddress) return;
  const registry = await hre.ethers.getContractAt("ZedkrCollateralRegistry", registryAddr);
  const ok = await registry.isWhitelisted(tokenAddr);
  if (ok) {
    console.log("  Already whitelisted on ZedkrCollateralRegistry");
    return;
  }
  await (await registry.connect(deployer).whitelistCollateral(tokenAddr)).wait();
  console.log("  Whitelisted on ZedkrCollateralRegistry");
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const networkName = hre.network.name;

  console.log("Deployer:", deployer.address);
  console.log("Network:", networkName, chainId);

  const USDGF = await hre.ethers.getContractFactory("USDG");
  const { instance: usdg, address: usdgAddr, blockNumber: usdgBlock } = await deployAndTrack(
    USDGF,
    deployer.address,
  );
  console.log(`USDG deployed: ${usdgAddr} (block ${usdgBlock})`);
  console.log("  Initial supply: 100,000 USDG to deployer");

  const extraMintHuman = process.env.USDG_EXTRA_MINT?.trim() || "1000000";
  const extra = BigInt(extraMintHuman) * 10n ** 6n;
  await (await usdg.mint(deployer.address, extra)).wait();
  console.log(`  Minted ${extraMintHuman} extra USDG to deployer`);

  const mintTo = process.env.USDG_MINT_TO?.trim();
  const mintAmountHuman = process.env.USDG_MINT_AMOUNT?.trim() || "10000";
  if (mintTo && mintTo !== hre.ethers.ZeroAddress) {
    const amt = BigInt(mintAmountHuman) * 10n ** 6n;
    await (await usdg.mint(mintTo, amt)).wait();
    console.log(`  Minted ${mintAmountHuman} USDG to ${mintTo}`);
  }

  const depPath = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  let prev = {};
  if (fs.existsSync(depPath)) {
    try {
      prev = JSON.parse(fs.readFileSync(depPath, "utf8"));
    } catch {
      // ignore
    }
  }

  const outPath = mergeDeployment(chainId, networkName, {
    deployer: deployer.address,
    contracts: { USDG: usdgAddr },
    deploymentBlocks: { USDG: usdgBlock },
    external: { pons: { usdg: usdgAddr } },
  });
  console.log("Wrote:", outPath);

  const registryAddr = prev.contracts?.ZedkrCollateralRegistry;
  await maybeWhitelist(registryAddr, usdgAddr, deployer);

  const bal = await usdg.balanceOf(deployer.address);
  console.log(`Deployer balance: ${hre.ethers.formatUnits(bal, 6)} USDG`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

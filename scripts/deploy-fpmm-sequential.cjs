/* eslint-disable no-console */
/**
 * Deploy FPMM stack one step at a time. Reuses mock USDG / vault / USDC / WETH.
 * Writes progress to deployments/robinhood-fpmm-redeploy.json after every success.
 * Only merges into the live deployment JSON after factory.marketDeployer is set.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-fpmm-sequential.cjs --network robinhoodMainnet
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { registerPriceFeedsOnFactory } = require("./lib/register-price-feeds.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ROOT = path.join(__dirname, "..");
const PROGRESS_FILE = path.join(ROOT, "deployments", "robinhood-fpmm-redeploy.json");

function writeProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
  console.log(`  saved ${PROGRESS_FILE}`);
}

async function deployAndTrack(factory, ...args) {
  const instance = await factory.deploy(...args);
  const receipt = await instance.deploymentTransaction().wait();
  return { instance, address: await instance.getAddress(), blockNumber: receipt.blockNumber };
}

async function logWallet(label, signer) {
  const [bal, fee] = await Promise.all([
    hre.ethers.provider.getBalance(signer.address),
    hre.ethers.provider.getFeeData(),
  ]);
  const gp = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
  console.log(
    `\n[${label}] balance ${hre.ethers.formatEther(bal)} ETH | gas ${Number(gp) / 1e9} gwei`,
  );
  return { bal, gp };
}

function isInsufficient(err) {
  const msg = `${err?.shortMessage || ""} ${err?.message || ""} ${err?.info?.error?.message || ""}`.toLowerCase();
  return msg.includes("insufficient funds") || msg.includes("exceeds the balance");
}

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== 4663) throw new Error(`Expected Robinhood 4663, got ${chainId}`);

  const depPath = path.join(ROOT, "deployments", `${hre.network.name}-${chainId}.json`);
  const prev = JSON.parse(fs.readFileSync(depPath, "utf8"));
  const vault = prev.feeRecipient || prev.contracts.ZedkrFeeVault;
  const usdg = prev.contracts.USDG;
  const usdc = prev.contracts.ZedkrUSDC;
  const weth = prev.contracts.WETH;
  const collaterals = [usdc, weth, usdg].filter(Boolean);
  const feeds = prev.external?.chainlinkFeeds ?? [];
  const admins = prev.resolutionAdmins ?? [];
  const ponsAdmin = prev.nadResolutionAdmin || signer.address;

  const progress = fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"))
    : {
        startedAt: new Date().toISOString(),
        reused: { USDG: usdg, ZedkrUSDC: usdc, WETH: weth, treasury: vault },
        contracts: {},
        blocks: {},
        steps: [],
      };

  console.log("Order (reuse mock USDG, do not redeploy tokens/vault):");
  console.log("  1. ZedkrCollateralRegistry");
  console.log("  2. ZedkrFpmmMarketFactory  (owner, treasury=vault, registry)");
  console.log("  3. ZedkrFpmmDeployer       (factory)  ← biggest");
  console.log("  4. factory.setMarketDeployer");
  console.log("  5. setResolutionAdmins + setTokenResolutionAdmin");
  console.log("  6. register Chainlink feeds");
  console.log("  7. whitelist USDC / WETH / mock USDG");
  console.log("  8. orderbook adapter + ZedkrOrderBook");
  console.log("Deployer:", signer.address);
  console.log("Mock USDG:", usdg);
  console.log("Treasury (vault):", vault);

  const done = new Set(progress.steps);

  try {
    if (!progress.contracts.ZedkrCollateralRegistry) {
      await logWallet("1/8 registry", signer);
      const F = await hre.ethers.getContractFactory("ZedkrCollateralRegistry");
      const { instance, address, blockNumber } = await deployAndTrack(F, signer.address);
      progress.contracts.ZedkrCollateralRegistry = address;
      progress.blocks.ZedkrCollateralRegistry = blockNumber;
      progress.steps.push("registry");
      writeProgress(progress);
      console.log(`  registry ${address} block ${blockNumber}`);
    } else {
      console.log(`\n[1/8] skip registry (already ${progress.contracts.ZedkrCollateralRegistry})`);
    }

    if (!progress.contracts.ZedkrFpmmMarketFactory) {
      await logWallet("2/8 factory", signer);
      const F = await hre.ethers.getContractFactory("ZedkrFpmmMarketFactory");
      const { instance, address, blockNumber } = await deployAndTrack(
        F,
        signer.address,
        vault,
        progress.contracts.ZedkrCollateralRegistry,
      );
      progress.contracts.ZedkrFpmmMarketFactory = address;
      progress.blocks.ZedkrFpmmMarketFactory = blockNumber;
      progress.factoryInstanceNeeded = true;
      progress.steps.push("factory");
      writeProgress(progress);
      console.log(`  factory ${address} block ${blockNumber}`);
    } else {
      console.log(`\n[2/8] skip factory (already ${progress.contracts.ZedkrFpmmMarketFactory})`);
    }

    if (!progress.contracts.ZedkrFpmmDeployer) {
      await logWallet("3/8 deployer (largest)", signer);
      const F = await hre.ethers.getContractFactory("ZedkrFpmmDeployer");
      const { address, blockNumber } = await deployAndTrack(F, progress.contracts.ZedkrFpmmMarketFactory);
      progress.contracts.ZedkrFpmmDeployer = address;
      progress.blocks.ZedkrFpmmDeployer = blockNumber;
      progress.steps.push("fpmmDeployer");
      writeProgress(progress);
      console.log(`  fpmm deployer ${address} block ${blockNumber}`);
    } else {
      console.log(`\n[3/8] skip deployer (already ${progress.contracts.ZedkrFpmmDeployer})`);
    }

    if (!progress.contracts.ZedkrFpmmDeployer) {
      throw new Error("FPMM deployer missing — cannot continue");
    }

    const factory = await hre.ethers.getContractAt(
      "ZedkrFpmmMarketFactory",
      progress.contracts.ZedkrFpmmMarketFactory,
      signer,
    );
    const registry = await hre.ethers.getContractAt(
      "ZedkrCollateralRegistry",
      progress.contracts.ZedkrCollateralRegistry,
      signer,
    );

    const linked = await factory.marketDeployer();
    if (linked.toLowerCase() !== progress.contracts.ZedkrFpmmDeployer.toLowerCase()) {
      await logWallet("4/8 setMarketDeployer", signer);
      await (await factory.setMarketDeployer(progress.contracts.ZedkrFpmmDeployer)).wait();
      progress.steps.push("setMarketDeployer");
      writeProgress(progress);
      console.log("  factory.marketDeployer linked");
    } else {
      console.log("\n[4/8] skip setMarketDeployer (already linked)");
    }

    if (!progress.steps.includes("admins")) {
      await logWallet("5/8 admins", signer);
      if (admins.length >= 3) {
        await (await factory.setResolutionAdmins(admins)).wait();
        console.log(`  resolution admins (${admins.length})`);
      } else {
        console.warn("  fewer than 3 resolution admins — skipped");
      }
      await (await factory.setTokenResolutionAdmin(ponsAdmin)).wait();
      console.log(`  tokenResolutionAdmin ${ponsAdmin}`);
      progress.steps.push("admins");
      writeProgress(progress);
    } else {
      console.log("\n[5/8] skip admins");
    }

    if (!progress.steps.includes("feeds")) {
      await logWallet("6/8 feeds", signer);
      if (feeds.length > 0) {
        await registerPriceFeedsOnFactory(factory, feeds, hre.ethers);
      }
      progress.steps.push("feeds");
      writeProgress(progress);
    } else {
      console.log("\n[6/8] skip feeds");
    }

    if (!progress.steps.includes("whitelist")) {
      await logWallet("7/8 whitelist", signer);
      for (const token of collaterals) {
        await (await registry.whitelistCollateral(token)).wait();
        console.log(`  whitelisted ${token}`);
      }
      progress.steps.push("whitelist");
      writeProgress(progress);
    } else {
      console.log("\n[7/8] skip whitelist");
    }

    if (!progress.contracts.ZedkrFpmmOrderBookFactoryAdapter) {
      await logWallet("8a/8 adapter", signer);
      const F = await hre.ethers.getContractFactory("ZedkrFpmmOrderBookFactoryAdapter");
      const { address, blockNumber } = await deployAndTrack(F, progress.contracts.ZedkrFpmmMarketFactory);
      progress.contracts.ZedkrFpmmOrderBookFactoryAdapter = address;
      progress.blocks.ZedkrFpmmOrderBookFactoryAdapter = blockNumber;
      progress.steps.push("adapter");
      writeProgress(progress);
      console.log(`  adapter ${address} block ${blockNumber}`);
    } else {
      console.log(`\n[8a/8] skip adapter (already ${progress.contracts.ZedkrFpmmOrderBookFactoryAdapter})`);
    }

    if (!progress.contracts.ZedkrOrderBook) {
      await logWallet("8b/8 orderbook", signer);
      const F = await hre.ethers.getContractFactory("ZedkrOrderBook");
      const { address, blockNumber } = await deployAndTrack(
        F,
        progress.contracts.ZedkrFpmmOrderBookFactoryAdapter,
        signer.address,
        vault,
      );
      progress.contracts.ZedkrOrderBook = address;
      progress.blocks.ZedkrOrderBook = blockNumber;
      progress.steps.push("orderbook");
      writeProgress(progress);
      console.log(`  orderbook ${address} block ${blockNumber}`);
    } else {
      console.log(`\n[8b/8] skip orderbook (already ${progress.contracts.ZedkrOrderBook})`);
    }

    progress.finishedAt = new Date().toISOString();
    writeProgress(progress);

    const live = JSON.parse(fs.readFileSync(depPath, "utf8"));
    live.contracts = { ...live.contracts, ...progress.contracts };
    live.deploymentBlocks = { ...live.deploymentBlocks, ...progress.blocks };
    live.notes = {
      ...(live.notes ?? {}),
      primaryMarketFactory: "ZedkrFpmmMarketFactory",
      fpmmCollaterals: collaterals,
      feeFlow:
        "1% trade fee split 25/25/25/25 creator / platformDev / distribution / treasury; address(0) share pays the market creator",
    };
    live.deployedAt = new Date().toISOString();
    fs.writeFileSync(depPath, `${JSON.stringify(live, null, 2)}\n`, "utf8");
    const adminPath = path.join(ROOT, "admin", "deployments", `${hre.network.name}-${chainId}.json`);
    if (fs.existsSync(path.dirname(adminPath))) {
      fs.writeFileSync(adminPath, `${JSON.stringify(live, null, 2)}\n`, "utf8");
    }
    console.log("\nMerged into live deployment JSON.");
    await logWallet("done", signer);
  } catch (err) {
    const { bal } = await logWallet("STOPPED", signer);
    writeProgress({ ...progress, stoppedAt: new Date().toISOString(), error: err.shortMessage || err.message });
    if (isInsufficient(err)) {
      console.error("\nStopped: insufficient ETH.");
      console.error(`Remaining: ${hre.ethers.formatEther(bal)} ETH`);
      console.error("Progress file has every address that landed. Live app JSON was NOT switched.");
      process.exit(2);
    }
    throw err;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

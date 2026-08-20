/* eslint-disable no-console */
/**
 * Resume Robinhood mainnet deploy after partial success (USDC + USDG + MONDO already live).
 *
 * Usage:
 *   RPC_URL=https://rpc.mainnet.chain.robinhood.com npx hardhat run scripts/resume-robinhood-deploy.cjs --network robinhoodMainnet
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const hre = require("hardhat");
const { deployParimutuelFacade } = require("./lib/deploy-parimutuel-facade.cjs");
const { deployFpmmStack } = require("./lib/deploy-fpmm-stack.cjs");
const { WALLETS_PATH } = require("./lib/aftr-scripts-lib.cjs");
const { robinhoodNetworkExternals } = require("./lib/robinhood-chainlink-feeds.cjs");
const { registerPriceFeedsOnFactory } = require("./lib/register-price-feeds.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

/** From failed full-stack run 2026-08-20 */
const PARTIAL = {
  MondaloreUSDC: "0x43b322f8dc4D6cE4dE56054cDf5E7b1e3Fb06FB7",
  USDG: "0x472028E12b4Ab5F873b712E348d32950cd6D26a7",
  MondaloreToken: "0x43Df432c9C3E7A05e2b485f6E3ea9e3d10942f35",
  deploymentBlocks: {
    MondaloreUSDC: 41323004,
    USDG: 41323205,
    MondaloreToken: 41323318,
  },
};

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function deployAndTrack(factory, ...args) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const instance = await factory.deploy(...args);
      const receipt = await instance.deploymentTransaction().wait();
      return { instance, address: await instance.getAddress(), blockNumber: receipt.blockNumber };
    } catch (e) {
      lastErr = e;
      const msg = e?.message || String(e);
      console.warn(`  deploy attempt ${attempt} failed: ${msg.slice(0, 120)}`);
      if (attempt < 4) await sleep(3000 * attempt);
    }
  }
  throw lastErr;
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

function writeDeploymentJson(hre_, data) {
  const root = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(root, { recursive: true });
  const networkName = hre_.network.name;
  const chainId = Number(data.chainId);
  const outPath = path.join(root, `${networkName}-${chainId}.json`);
  let prev = {};
  if (fs.existsSync(outPath)) {
    try {
      prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch {
      // ignore
    }
  }
  const payload = {
    ...prev,
    ...data,
    network: networkName,
    chainId,
    deployedAt: new Date().toISOString(),
    external: { ...(prev.external ?? {}), ...(data.external ?? {}) },
    contracts: { ...(prev.contracts ?? {}), ...(data.contracts ?? {}) },
    deploymentBlocks: { ...(prev.deploymentBlocks ?? {}), ...(data.deploymentBlocks ?? {}) },
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("Wrote deployment record:", outPath);
  return outPath;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== 4663) {
    throw new Error(`Expected Robinhood mainnet (4663), got ${chainId}. Set RPC_URL to Robinhood.`);
  }

  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "ETH");
  console.log("Resuming from FeeVault with:");
  console.log("  MondaloreUSDC:", PARTIAL.MondaloreUSDC);
  console.log("  USDG (mock):  ", PARTIAL.USDG);
  console.log("  MondaloreToken:", PARTIAL.MondaloreToken);

  const rh = robinhoodNetworkExternals();
  const aftrUsdcAddr = PARTIAL.MondaloreUSDC;
  const usdgAddr = PARTIAL.USDG;
  const aftrTokenAddr = PARTIAL.MondaloreToken;
  const weth = rh.weth;
  const realRobinhoodUsdg = rh.usdg;
  const deploymentBlocks = { ...PARTIAL.deploymentBlocks };
  const epochDuration = BigInt(process.env.VAULT_EPOCH_DURATION?.trim() || "604800");
  const lockDuration = BigInt(process.env.VAULT_LOCK_DURATION?.trim() || "604800");
  const resolutionAdmins = loadResolutionAdmins(deployer.address);

  // Persist partial progress immediately
  writeDeploymentJson(hre, {
    chainId,
    deployer: deployer.address,
    contracts: {
      MondaloreUSDC: aftrUsdcAddr,
      USDG: usdgAddr,
      MondaloreToken: aftrTokenAddr,
      WETH: weth,
    },
    deploymentBlocks,
    external: {
      optimisticOracleV2: rh.oo,
      chainlinkFeeds: rh.chainlinkFeeds,
      priceFeedAssets: rh.priceFeedAssets,
      vaultCollateralOptions: rh.vaultCollateralOptions,
      pons: { ...rh.pons, usdg: realRobinhoodUsdg },
    },
  });

  console.log("\n[3/7] Deploying MondaloreFeeVault...");
  const VaultF = await hre.ethers.getContractFactory("MondaloreFeeVault");
  const { instance: vault, address: vaultAddr, blockNumber: vaultBlock } = await deployAndTrack(
    VaultF,
    deployer.address,
    aftrTokenAddr,
    epochDuration,
    lockDuration,
  );
  deploymentBlocks.MondaloreFeeVault = vaultBlock;
  console.log(`  MondaloreFeeVault: ${vaultAddr} (block ${vaultBlock})`);

  console.log("\n[4/7] Deploying MondaloreParimutuelMarketFactory...");
  const FactoryF = await hre.ethers.getContractFactory("MondaloreParimutuelMarketFactory");
  const { instance: factory, address: factoryAddress, blockNumber: factoryBlock } = await deployAndTrack(
    FactoryF,
    deployer.address,
    vaultAddr,
    hre.ethers.ZeroAddress,
    hre.ethers.ZeroAddress,
  );
  deploymentBlocks.MondaloreParimutuelMarketFactory = factoryBlock;
  console.log(`  Factory: ${factoryAddress} (block ${factoryBlock})`);

  if (resolutionAdmins.length >= 3) {
    await (await factory.setResolutionAdmins(resolutionAdmins)).wait();
    console.log("  Resolution admins:", resolutionAdmins.join(", "));
  } else if (resolutionAdmins.length > 0) {
    await (await factory.setResolutionAdmins(resolutionAdmins)).wait();
    console.warn("  WARNING: fewer than 3 RESOLUTION_ADMINS");
  }

  if (rh.chainlinkFeeds?.length) {
    console.log(`  Registering ${rh.chainlinkFeeds.length} Chainlink feeds…`);
    await registerPriceFeedsOnFactory(factory, rh.chainlinkFeeds, hre.ethers);
  }

  console.log("\n[5/7] Deploying MondaloreParimutuelDeployer + sub-deployers...");
  const {
    marketDeployerAddress,
    facadeBlock,
    priceDep,
    eventDep,
    priceBlock,
    eventBlock,
  } = await deployParimutuelFacade(hre, deployer, factoryAddress, deployAndTrack);
  deploymentBlocks.MondaloreParimutuelDeployer = facadeBlock;
  deploymentBlocks.MondalorePriceMarketDeployer = priceBlock;
  deploymentBlocks.MondaloreEventMarketDeployer = eventBlock;
  console.log(`  Price deployer: ${priceDep}`);
  console.log(`  Event deployer: ${eventDep}`);
  console.log(`  Facade:         ${marketDeployerAddress}`);

  await (await factory.setMarketDeployer(marketDeployerAddress)).wait();
  console.log("  Linked factory.marketDeployer");

  console.log("  Registering collaterals: MondaloreUSDC, WETH, USDG (mock), native ETH");
  await (await factory.addSupportedCollateral(aftrUsdcAddr)).wait();
  await (await factory.addSupportedCollateral(weth)).wait();
  await (await factory.setWrappedNativeToken(weth)).wait();
  await (await factory.addSupportedCollateral(hre.ethers.ZeroAddress)).wait();
  await (await factory.addSupportedCollateral(usdgAddr)).wait();

  console.log("  Registering vault reward tokens...");
  await (await vault.addRewardToken(aftrUsdcAddr)).wait();
  await (await vault.addRewardToken(weth)).wait();
  await (await vault.addRewardToken(usdgAddr)).wait();
  await (await vault.addRewardToken(hre.ethers.ZeroAddress)).wait();

  console.log("\n[6/7] Deploying MondaloreOrderBook...");
  const OrderBookF = await hre.ethers.getContractFactory("MondaloreOrderBook");
  const { address: orderBookAddress, blockNumber: orderBookBlock } = await deployAndTrack(
    OrderBookF,
    factoryAddress,
    deployer.address,
    deployer.address,
  );
  deploymentBlocks.MondaloreOrderBook = orderBookBlock;
  console.log(`  OrderBook: ${orderBookAddress}`);

  console.log("\n[7/7] Deploying Zedkr FPMM stack...");
  const fpmmBotAdmin =
    process.env.PONS_RESOLUTION_ADMIN?.trim() ||
    process.env.NAD_RESOLUTION_ADMIN?.trim() ||
    deployer.address;
  const fpmmResult = await deployFpmmStack(hre, deployer, vaultAddr, {
    deployAndTrack,
    deploymentBlocks,
    chainlinkFeeds: rh.chainlinkFeeds,
    collateralTokens: [aftrUsdcAddr, weth, usdgAddr],
    resolutionAdmins,
    ponsResolutionAdmin: fpmmBotAdmin,
  });

  writeDeploymentJson(hre, {
    chainId,
    deployer: deployer.address,
    feeRecipient: vaultAddr,
    contracts: {
      MondaloreToken: aftrTokenAddr,
      MondaloreFeeVault: vaultAddr,
      MondaloreUSDC: aftrUsdcAddr,
      USDG: usdgAddr,
      MondaloreParimutuelMarketFactory: factoryAddress,
      MondalorePriceMarketDeployer: priceDep,
      MondaloreEventMarketDeployer: eventDep,
      MondaloreParimutuelDeployer: marketDeployerAddress,
      MondaloreOrderBook: orderBookAddress,
      ZedkrCollateralRegistry: fpmmResult.registry,
      ZedkrFpmmMarketFactory: fpmmResult.fpmmFactory,
      ZedkrFpmmDeployer: fpmmResult.fpmmDeployer,
      WETH: weth,
    },
    deploymentBlocks,
    external: {
      optimisticOracleV2: rh.oo,
      umaBondCurrencyCircleUSDC: aftrUsdcAddr,
      chainlinkFeeds: rh.chainlinkFeeds,
      priceFeedAssets: rh.priceFeedAssets,
      vaultCollateralOptions: [
        { label: "WETH", address: weth },
        { label: "USDG (mock)", address: usdgAddr },
        { label: "USDG (canonical)", address: realRobinhoodUsdg },
      ],
      pons: { ...rh.pons, usdg: realRobinhoodUsdg },
    },
    vault: {
      stakeToken: aftrTokenAddr,
      epochDuration: epochDuration.toString(),
      lockDuration: lockDuration.toString(),
      rewardTokens: [aftrUsdcAddr, weth, usdgAddr, "0x0000000000000000000000000000000000000000"],
    },
    resolutionAdmins,
    nadResolutionAdmin: fpmmBotAdmin,
    notes: {
      tradingCollaterals: ["MondaloreUSDC", "USDG (mock mintable)", "WETH", "ETH"],
      fpmmCollaterals: [aftrUsdcAddr, weth, usdgAddr],
      primaryMarketFactory: "ZedkrFpmmMarketFactory",
      feeFlow: "Market deposit → 0.4% protocol fee → MondaloreFeeVault.receiveFees()",
      chainlinkSource: "https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood",
      ponsDocs: "https://docs.ponsfamily.com/v2",
    },
  });

  try {
    execSync("node scripts/subgraph-update-config.cjs", {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        DEPLOYMENT_FILE: path.join(__dirname, "..", "deployments", "robinhoodMainnet-4663.json"),
        SUBGRAPH_NETWORK: process.env.SUBGRAPH_NETWORK || "robinhood-mainnet",
      },
      stdio: "inherit",
    });
  } catch (e) {
    console.warn("  subgraph-update-config failed:", e?.message ?? e);
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Robinhood resume complete.");
  console.log(`  MondaloreFeeVault:      ${vaultAddr}`);
  console.log(`  Parimutuel Factory:     ${factoryAddress}`);
  console.log(`  ZedkrFpmmMarketFactory: ${fpmmResult.fpmmFactory}`);
  console.log(`  USDG (mock):            ${usdgAddr}`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

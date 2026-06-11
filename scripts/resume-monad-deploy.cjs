/* eslint-disable no-console */
/**
 * Resume a partial deploy-aftr-full-stack run on Monad testnet.
 *
 * Usage:
 *   npx hardhat run scripts/resume-monad-deploy.cjs --network monadTestnet
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const hre = require("hardhat");
const { deployParimutuelFacade } = require("./lib/deploy-parimutuel-facade.cjs");
const { WALLETS_PATH } = require("./lib/aftr-scripts-lib.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const PARTIAL = {
  MockWETH: "0xF2760b7Fd5887f40F526200e3e435a63B7e5CAf8",
  MondaloreUSDC: "0x9adECb575C30eB841ad2fDd153FE859DF861c338",
  MondaloreToken: "0x9AbbC7e9c23CCC5C359732b9b05Ef4f510CAAd53",
  MondaloreFeeVault: "0x3870Fd628e43FbEE7f2a1a922ACa13b3f1B53329",
  MondaloreParimutuelMarketFactory: "0xFd5109fA917203947E350218928e3e39f5936813",
  deploymentBlocks: {
    MockWETH: 37395453,
    MondaloreUSDC: 37395466,
    MondaloreToken: 37395478,
    MondaloreFeeVault: 37395486,
    MondaloreParimutuelMarketFactory: 37395492,
  },
};

const MONAD_TESTNET_CHAINLINK = [
  { label: "ETH/USD", asset: "ETH", logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png", address: "0x0c76859E85727683Eeba0C70Bc2e0F5781337818" },
  { label: "BTC/USD", asset: "BTC", logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png", address: "0x2Cd9D7E85494F68F5aF08EF96d6FD5e8F71B4d31" },
  { label: "LINK/USD", asset: "LINK", logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png", address: "0x4682035965Cd2B88759193ee2660d8A0766e1391" },
  { label: "USDC/USD", asset: "USDC", logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png", address: "0x70BB0758a38ae43418ffcEd9A25273dd4e804D15" },
  { label: "USDT/USD", asset: "USDT", logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png", address: "0x14eE6bE30A91989851Dc23203E41C804D4D71441" },
];

async function deployAndTrack(factory, ...args) {
  const instance = await factory.deploy(...args);
  const receipt = await instance.deploymentTransaction().wait();
  const address = await instance.getAddress();
  return { instance, address, blockNumber: receipt.blockNumber };
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
    } catch {}
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
    try { prev = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch {}
  }
  const payload = {
    ...prev,
    ...data,
    network: networkName,
    chainId,
    deployedAt: new Date().toISOString(),
    external: { ...(prev.external ?? {}), ...(data.external ?? {}) },
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("Wrote deployment record:", outPath);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "MON");

  const chainId = 10143;
  const aftrUsdcAddr = PARTIAL.MondaloreUSDC;
  const aftrTokenAddr = PARTIAL.MondaloreToken;
  const vaultAddr = PARTIAL.MondaloreFeeVault;
  const factoryAddress = PARTIAL.MondaloreParimutuelMarketFactory;
  const weth = PARTIAL.MockWETH;
  const deploymentBlocks = { ...PARTIAL.deploymentBlocks };
  const epochDuration = BigInt(process.env.VAULT_EPOCH_DURATION?.trim() || "604800");
  const lockDuration = BigInt(process.env.VAULT_LOCK_DURATION?.trim() || "604800");
  const resolutionAdmins = loadResolutionAdmins(deployer.address);

  const vault = await hre.ethers.getContractAt("MondaloreFeeVault", vaultAddr);
  const factory = await hre.ethers.getContractAt("MondaloreParimutuelMarketFactory", factoryAddress);

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
  console.log(`  MondalorePriceMarketDeployer:  ${priceDep} (block ${priceBlock})`);
  console.log(`  MondaloreEventMarketDeployer:  ${eventDep} (block ${eventBlock})`);
  console.log(`  MondaloreParimutuelDeployer:   ${marketDeployerAddress} (block ${facadeBlock})`);

  await (await factory.setMarketDeployer(marketDeployerAddress)).wait();
  console.log("  Linked factory.marketDeployer");

  console.log("  Registering collaterals: MondaloreUSDC, WETH");
  await (await factory.addSupportedCollateral(aftrUsdcAddr)).wait();
  await (await factory.addSupportedCollateral(weth)).wait();

  console.log("  Registering vault reward tokens...");
  await (await vault.addRewardToken(aftrUsdcAddr)).wait();
  await (await vault.addRewardToken(weth)).wait();
  await (await vault.addRewardToken("0x0000000000000000000000000000000000000000")).wait();

  console.log("\n[6/7] Deploying MondaloreOrderBook...");
  const OrderBookF = await hre.ethers.getContractFactory("MondaloreOrderBook");
  const { address: orderBookAddress, blockNumber: orderBookBlock } =
    await deployAndTrack(OrderBookF, factoryAddress, deployer.address, deployer.address);
  deploymentBlocks.MondaloreOrderBook = orderBookBlock;
  console.log(`  OrderBook: ${orderBookAddress} (block ${orderBookBlock})`);

  writeDeploymentJson(hre, {
    chainId,
    deployer: deployer.address,
    feeRecipient: vaultAddr,
    contracts: {
      MondaloreToken: aftrTokenAddr,
      MondaloreFeeVault: vaultAddr,
      MondaloreUSDC: aftrUsdcAddr,
      MondaloreParimutuelMarketFactory: factoryAddress,
      MondalorePriceMarketDeployer: priceDep,
      MondaloreEventMarketDeployer: eventDep,
      MondaloreParimutuelDeployer: marketDeployerAddress,
      MondaloreOrderBook: orderBookAddress,
      MockWETH: weth,
    },
    deploymentBlocks,
    external: {
      optimisticOracleV2: process.env.UMA_OOV2?.trim() || "0x0000000000000000000000000000000000000001",
      umaBondCurrencyCircleUSDC: aftrUsdcAddr,
      chainlinkFeeds: MONAD_TESTNET_CHAINLINK,
      vaultCollateralOptions: [{ label: "WETH", address: weth }],
    },
    vault: {
      stakeToken: aftrTokenAddr,
      epochDuration: epochDuration.toString(),
      lockDuration: lockDuration.toString(),
      rewardTokens: [aftrUsdcAddr, weth, "0x0000000000000000000000000000000000000000"],
    },
    resolutionAdmins,
    notes: {
      tradingCollaterals: ["MondaloreUSDC", "WETH"],
      feeFlow: "Market deposit → 1.2% → MondaloreFeeVault.receiveFees() → 0.2% stakers / 1.0% treasury",
    },
  });

  try {
    execSync("node scripts/subgraph-update-config.cjs", { cwd: path.join(__dirname, ".."), stdio: "inherit" });
    console.log("  Patched subgraph/subgraph.yaml");
  } catch (e) {
    console.warn("  subgraph-update-config failed:", e?.message ?? e);
  }

  console.log("\nResume complete.");
  console.log(`  Vault:   ${vaultAddr}`);
  console.log(`  Factory: ${factoryAddress}`);
  console.log(`  OrderBook: ${orderBookAddress}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

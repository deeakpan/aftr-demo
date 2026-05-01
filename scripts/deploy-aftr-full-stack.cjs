/* eslint-disable no-console */
/**
 * Deploy fresh USDeAD + DRP stack, minted AFTRUSDC test token, prediction factory + orderbook,
 * multiple collaterals (AFTR USDC, USDeAD, Circle Sepolia USDC), debt router,
 * then whitelist the router as a trusted vault manager on DRP.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-aftr-full-stack.cjs --network baseSepolia
 *
 * Env (optional, defaults to deployer):
 *   DRP_DEFAULT_ADMIN — USDeAD initial owner path (normally deployer → transferOwnership to DRP)
 *   DRP_PARAM_SETTER_ADMIN — must be able to schedule/execute timelocked ops including SetVaultManager
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

/** Circle test USDC on Base Sepolia (UMA-whitelisted). */
const BASE_SEPOLIA_CIRCLE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const UMA_REWARD_USDC = 500_000n;

const OOv2_BASE_SEPOLIA = "0x99EC530a761E68a377593888D9504002Bd191717";
const canonicalWeth = "0x4200000000000000000000000000000000000006";
const defaultEthFeed = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1";

/** TimelockOp.SetVaultManager in DeaderalReserveProtocol.sol */
const TIMELOCK_OP_SET_VAULT_MANAGER = 2;

function writeDeploymentJson(hre_, data) {
  const root = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(root, { recursive: true });
  const networkName = hre_.network.name;
  const chainId = Number(data.chainId);
  const fileName = `${networkName}-${chainId}.json`;
  const outPath = path.join(root, fileName);
  const payload = {
    ...data,
    network: networkName,
    chainId,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("Wrote deployment record:", outPath);
  return outPath;
}

function tryReadDeployment(networkName, chainId) {
  const outPath = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(outPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(outPath, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const defaultAdmin = process.env.DRP_DEFAULT_ADMIN?.trim() || deployer.address;
  const paramSetterAdmin =
    process.env.DRP_PARAM_SETTER_ADMIN?.trim() || deployer.address;
  const distro = process.env.DRP_DISTRO?.trim() || deployer.address;
  const vaultDistributor =
    process.env.DRP_VAULT_DISTRIBUTOR?.trim() || deployer.address;
  const weth = process.env.DRP_WETH?.trim() || canonicalWeth;
  const reth = process.env.DRP_RETH?.trim() || weth;
  const wstETH = process.env.DRP_WSTETH?.trim() || weth;
  const wethFeed = process.env.DRP_WETH_FEED?.trim() || defaultEthFeed;
  const rethFeed = process.env.DRP_RETH_FEED?.trim() || defaultEthFeed;
  const wstETHFeed = process.env.DRP_WSTETH_FEED?.trim() || defaultEthFeed;

  const prev = tryReadDeployment(hre.network.name, chainId);

  // --- USDeAD + mocks + DRP (same shape as deploy-drp-stack.cjs) ---
  const USDeADF = await hre.ethers.getContractFactory("USDeAD");
  const usdead = await USDeADF.deploy(defaultAdmin);
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
  } catch (e) {
    console.log("Skipped setDRP:", e.shortMessage ?? e.message);
  }

  if (defaultAdmin.toLowerCase() === deployer.address.toLowerCase()) {
    await (await usdead.transferOwnership(drpAddress)).wait();
    console.log("Transferred USDeAD ownership to DRP");
  } else {
    console.log(
      "Skipped USDeAD ownership transfer; run USDeAD.transferOwnership(DRP):",
      drpAddress,
    );
  }

  // --- AFTRUSDC (6-dec test mint token) ---
  const AFTRFactory = await hre.ethers.getContractFactory("AFTRUSDC");
  const aftrUsdcTok = await AFTRFactory.deploy(deployer.address);
  await aftrUsdcTok.waitForDeployment();
  const aftrUsdcAddr = await aftrUsdcTok.getAddress();
  console.log("AFTRUSDC (6-dec test collateral):", aftrUsdcAddr);

  const feeRecipient = deployer.address;
  const Factory = await hre.ethers.getContractFactory("AFTRParimutuelMarketFactory");
  const factory = await Factory.deploy(
    deployer.address,
    feeRecipient,
    OOv2_BASE_SEPOLIA,
    BASE_SEPOLIA_CIRCLE_USDC,
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("AFTRParimutuelMarketFactory:", factoryAddress);

  const DeployerLib = await hre.ethers.getContractFactory("AFTRParimutuelDeployer");
  const marketDeployer = await DeployerLib.deploy(factoryAddress);
  await marketDeployer.waitForDeployment();
  const marketDeployerAddress = await marketDeployer.getAddress();
  console.log("AFTRParimutuelDeployer:", marketDeployerAddress);

  await (await factory.setMarketDeployer(marketDeployerAddress)).wait();
  console.log("Linked factory.marketDeployer");

  console.log("Registering collateral: AFTRUSDC, USDeAD, Circle USDC");
  await (await factory.addSupportedCollateral(aftrUsdcAddr)).wait();
  await (await factory.addSupportedCollateral(usdeadAddress)).wait();
  await (await factory.addSupportedCollateral(BASE_SEPOLIA_CIRCLE_USDC)).wait();

  const OrderBook = await hre.ethers.getContractFactory("AFTROrderBook");
  const orderBook = await OrderBook.deploy(factoryAddress, deployer.address, deployer.address);
  await orderBook.waitForDeployment();
  const orderBookAddress = await orderBook.getAddress();
  console.log("AFTROrderBook:", orderBookAddress);

  const RouterF = await hre.ethers.getContractFactory("AFTRMarketDebtRouter");
  const router = await RouterF.deploy(factoryAddress, drpAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("AFTRMarketDebtRouter:", routerAddress);

  const external = {
    ...(prev?.external ?? {}),
    optimisticOracleV2: OOv2_BASE_SEPOLIA,
    umaBondCurrencyCircleUSDC: BASE_SEPOLIA_CIRCLE_USDC,
  };

  writeDeploymentJson(hre, {
    chainId,
    deployer: deployer.address,
    feeRecipient,
    contracts: {
      AFTRUSDC: aftrUsdcAddr,
      USDeAD: usdeadAddress,
      DRP: drpAddress,
      AFTRParimutuelMarketFactory: factoryAddress,
      AFTRParimutuelDeployer: marketDeployerAddress,
      AFTROrderBook: orderBookAddress,
      AFTRMarketDebtRouter: routerAddress,
    },
    external,
    suggestedUmaReward: UMA_REWARD_USDC.toString(),
    notes: {
      tradingCollaterals: ["AFTRUSDC", "USDeAD", "Circle_Base_Sepolia_USDC"],
      umaRewardToken:
        "Circle Base Sepolia USDC when umaRewardCurrency is address(0) on factory",
    },
  });

  const signerAsParamSetter =
    paramSetterAdmin.toLowerCase() === deployer.address.toLowerCase();
  if (!signerAsParamSetter) {
    console.warn(
      "Deployer !== DRP_PARAM_SETTER_ADMIN — run npm run drp:enable-router-manager with that admin:",
      routerAddress,
    );
  } else {
    console.log(
      "Scheduling + executing TimelockOp.SetVaultManager on DRP so router can act as vault manager…",
    );
    try {
      const trustedBefore = await drp.trustedManagers(routerAddress);
      if (!trustedBefore) {
        await (
          await drp.schedule(TIMELOCK_OP_SET_VAULT_MANAGER, routerAddress, 1)
        ).wait();
        /** Some L2s batch sequential txs with identical `block.timestamp`; delay avoids validAt edge reverts on executeOp */
        await new Promise((r) => setTimeout(r, 4500));
        await (
          await drp.executeOp(TIMELOCK_OP_SET_VAULT_MANAGER)
        ).wait();
        const trustedNow = await drp.trustedManagers(routerAddress);
        console.log("Router trustedManagers:", trustedNow);
      } else {
        console.log("Router already trusted on DRP");
      }
    } catch (e) {
      console.warn(
        "Could not whitelist router via timelock (execute may need a retry). Run:\n",
        `  npm run drp:enable-router-manager -- --network ${hre.network.name}\n`,
        e?.shortMessage || e?.message || e,
      );
    }
  }

  console.log("\nDone. Next:");
  console.log("- Fund markets with collateral + create markets from the UI or scripts.");
  console.log("- Users must approve DRP + call approveManager(router,true) before router-backed vault deposits.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

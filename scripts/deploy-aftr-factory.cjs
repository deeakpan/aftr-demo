/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

/**
 * @param {import("hardhat").HardhatRuntimeEnvironment} hre_
 * @param {Record<string, unknown>} data
 */
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
}

/** Circle test USDC on Base Sepolia (UMA-whitelisted). Bond + reward currency for OO. */
const BASE_SEPOLIA_CIRCLE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** 0.5 USDC (6 decimals) — suggested `umaReward` on testnet. */
const UMA_REWARD_USDC = 500_000n;

function tryReadDeployment(networkName, chainId) {
  const outPath = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(outPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
    return parsed;
  } catch {
    return null;
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const { chainId } = await hre.ethers.provider.getNetwork();
  const previous = tryReadDeployment(hre.network.name, Number(chainId));
  const previousUsdc = previous?.contracts?.AFTRUSDC;

  let tradingTokenAddress;
  if (previousUsdc && hre.ethers.isAddress(previousUsdc)) {
    tradingTokenAddress = previousUsdc;
    console.log("Reusing existing AFTRUSDC:", tradingTokenAddress);
  } else {
    const USDC = await hre.ethers.getContractFactory("AFTRUSDC");
    const tradingToken = await USDC.deploy(deployer.address);
    await tradingToken.waitForDeployment();
    tradingTokenAddress = await tradingToken.getAddress();
    console.log("AFTRUSDC (trading collateral, 6 decimals, 100k minted to owner):", tradingTokenAddress);
  }

  const optimisticOracleV2 = "0x99EC530a761E68a377593888D9504002Bd191717";
  const feeRecipient = deployer.address;

  const Factory = await hre.ethers.getContractFactory("AFTRParimutuelMarketFactory");
  const factory = await Factory.deploy(
    deployer.address,
    feeRecipient,
    optimisticOracleV2,
    BASE_SEPOLIA_CIRCLE_USDC,
  );
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("AFTRParimutuelMarketFactory:", factoryAddress);
  console.log("Default UMA bond / reward currency (Circle Base Sepolia USDC):", BASE_SEPOLIA_CIRCLE_USDC);

  const Deployer = await hre.ethers.getContractFactory("AFTRParimutuelDeployer");
  const marketDeployer = await Deployer.deploy(factoryAddress);
  await marketDeployer.waitForDeployment();
  const marketDeployerAddress = await marketDeployer.getAddress();
  console.log("AFTRParimutuelDeployer:", marketDeployerAddress);

  await (await factory.setMarketDeployer(marketDeployerAddress)).wait();
  console.log("Linked factory.marketDeployer");

  await (await factory.addSupportedCollateral(tradingTokenAddress)).wait();
  console.log("Enabled trading collateral (AFTRUSDC):", tradingTokenAddress);

  const OrderBook = await hre.ethers.getContractFactory("AFTROrderBook");
  const orderBook = await OrderBook.deploy(factoryAddress, deployer.address, deployer.address);
  await orderBook.waitForDeployment();
  const orderBookAddress = await orderBook.getAddress();
  console.log("AFTROrderBook:", orderBookAddress);

  console.log("\n--- Event markets ---");
  console.log("Trading / pool collateral: AFTRUSDC at", tradingTokenAddress);
  console.log("UMA: fund with Circle USDC; umaRewardCurrency=0 uses factory default →", BASE_SEPOLIA_CIRCLE_USDC);
  console.log("Suggested umaReward (testnet):", UMA_REWARD_USDC.toString(), "(0.5 USDC, 6 decimals)");
  console.log("Before requestEventResolution: hold Circle USDC on market + market.fundUmaBond(umaReward) (approve market).");

  writeDeploymentJson(hre, {
    chainId: Number(chainId),
    deployer: deployer.address,
    feeRecipient: deployer.address,
    contracts: {
      AFTRUSDC: tradingTokenAddress,
      AFTRParimutuelMarketFactory: factoryAddress,
      AFTRParimutuelDeployer: marketDeployerAddress,
      AFTROrderBook: orderBookAddress,
    },
    external: {
      optimisticOracleV2,
      umaBondCurrencyCircleUSDC: BASE_SEPOLIA_CIRCLE_USDC,
    },
    suggestedUmaReward: UMA_REWARD_USDC.toString(),
    notes: {
      tradingCollateral: "AFTRUSDC",
      umaRewardToken: "Circle Base Sepolia USDC when umaRewardCurrency is address(0) on factory",
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

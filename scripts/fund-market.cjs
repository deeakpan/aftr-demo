/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

function parseCliArgs() {
  const args = process.argv.slice(2);
  let marketIdRaw;
  let amountRaw;
  let network;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--network") {
      network = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--amount") {
      amountRaw = args[i + 1];
      i += 1;
      continue;
    }
    if (!marketIdRaw) marketIdRaw = arg;
  }

  if (!marketIdRaw) {
    throw new Error("Missing market id. Usage: npm run market:fund -- <id> [--amount <tokenAmount>] [--network <name>]");
  }

  const marketId = Number(marketIdRaw);
  if (!Number.isInteger(marketId) || marketId < 0) {
    throw new Error(`Invalid market id: ${marketIdRaw}`);
  }

  return { marketId, amountRaw, network };
}

function readDeployment(hre, networkName, chainId) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Deployment file not found: ${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const factoryAddress = parsed?.contracts?.AFTRParimutuelMarketFactory;
  if (!factoryAddress || !hre.ethers.isAddress(factoryAddress)) {
    throw new Error("AFTRParimutuelMarketFactory missing in deployment file.");
  }
  const circleUsdc = parsed?.external?.umaBondCurrencyCircleUSDC;
  return { factoryAddress, file, circleUsdc };
}

async function main() {
  const { marketId, amountRaw, network: networkArg } = parseCliArgs();
  if (networkArg) process.env.HARDHAT_NETWORK = networkArg;
  const hre = require("hardhat");

  const [signer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;

  const { factoryAddress, file, circleUsdc } = readDeployment(hre, networkName, chainId);
  const factory = await hre.ethers.getContractAt("AFTRParimutuelMarketFactory", factoryAddress);

  const total = Number(await factory.marketsLength());
  if (marketId >= total) {
    throw new Error(`Market id ${marketId} out of range. Total markets: ${total}`);
  }

  const marketAddress = await factory.markets(BigInt(marketId));
  const market = await hre.ethers.getContractAt("AFTRVParimutuelMarket", marketAddress);
  const kind = Number(await market.marketKind());
  if (kind !== 1) {
    throw new Error("Only EVENT markets need UMA bond funding.");
  }

  const rewardCurrency = await market.umaRewardCurrency();
  const reward = await market.umaReward();
  const token = new hre.ethers.Contract(rewardCurrency, ERC20_ABI, signer);
  const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);

  const marketBal = await token.balanceOf(marketAddress);
  const missing = reward > marketBal ? reward - marketBal : 0n;
  const desired = amountRaw ? hre.ethers.parseUnits(amountRaw, decimals) : missing;

  console.log("Network:", networkName, chainId);
  console.log("Signer:", signer.address);
  console.log("Deployment:", file);
  console.log("Factory:", factoryAddress);
  console.log("Market id:", marketId);
  console.log("Market:", marketAddress);
  console.log("UMA reward token:", rewardCurrency, `(${symbol})`);
  if (circleUsdc) {
    console.log("Configured Circle USDC:", circleUsdc);
    if (circleUsdc.toLowerCase() !== rewardCurrency.toLowerCase()) {
      console.log("Warning: market UMA token differs from configured Circle USDC.");
    }
  }
  console.log("Required umaReward:", reward.toString());
  console.log("Current market UMA balance:", marketBal.toString());
  console.log("Missing to meet umaReward:", missing.toString());

  if (desired <= 0n) {
    console.log("No funding needed.");
    return;
  }

  const signerBal = await token.balanceOf(signer.address);
  if (signerBal < desired) {
    throw new Error(`Insufficient ${symbol}. Need ${desired.toString()}, have ${signerBal.toString()}.`);
  }

  const allowance = await token.allowance(signer.address, marketAddress);
  if (allowance < desired) {
    console.log("Approving market...");
    const approveTx = await token.approve(marketAddress, desired);
    console.log("Approve tx:", approveTx.hash);
    await approveTx.wait();
  }

  console.log("Calling fundUmaBond...");
  const fundTx = await market.fundUmaBond(desired);
  console.log("Fund tx:", fundTx.hash);
  await fundTx.wait();

  const newMarketBal = await token.balanceOf(marketAddress);
  console.log("New market UMA balance:", newMarketBal.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

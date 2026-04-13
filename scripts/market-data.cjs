/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function parseCliArgs() {
  const args = process.argv.slice(2);
  let marketIdRaw;
  let network;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--network") {
      network = args[i + 1];
      i += 1;
      continue;
    }
    if (!marketIdRaw) marketIdRaw = arg;
  }
  if (!marketIdRaw) {
    throw new Error("Usage: npm run market:data -- <id> [--network <name>]");
  }
  const marketId = Number(marketIdRaw);
  if (!Number.isInteger(marketId) || marketId < 0) {
    throw new Error(`Invalid market id: ${marketIdRaw}`);
  }
  return { marketId, network };
}

function readDeployment(hre, networkName, chainId) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`Deployment file not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const factoryAddress = parsed?.contracts?.AFTRParimutuelMarketFactory;
  if (!factoryAddress || !hre.ethers.isAddress(factoryAddress)) {
    throw new Error("AFTRParimutuelMarketFactory missing in deployment file.");
  }
  return { factoryAddress, file };
}

function stateLabel(state) {
  if (state === 0) return "OPEN";
  if (state === 1) return "AWAITING_UMA";
  if (state === 2) return "SETTLED";
  return `UNKNOWN(${state})`;
}

async function main() {
  const { marketId, network: networkArg } = parseCliArgs();
  if (networkArg) process.env.HARDHAT_NETWORK = networkArg;
  const hre = require("hardhat");

  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;
  const { factoryAddress, file } = readDeployment(hre, networkName, chainId);

  const factory = await hre.ethers.getContractAt("AFTRParimutuelMarketFactory", factoryAddress);
  const total = Number(await factory.marketsLength());
  if (marketId >= total) {
    throw new Error(`Market id ${marketId} out of range. Total markets: ${total}`);
  }

  const marketAddress = await factory.markets(BigInt(marketId));
  const market = await hre.ethers.getContractAt("AFTRVParimutuelMarket", marketAddress);

  const [
    marketKind,
    state,
    stakeEndTimestamp,
    resolveAfterTimestamp,
    numOutcomes,
    metadataURI,
    collateralAddress,
    collateralDecimals,
    winningOutcomeIndex,
    redemptionRate,
    umaIdentifier,
    umaLiveness,
    umaReward,
    umaRewardCurrency,
    umaRequestTimestamp,
  ] = await Promise.all([
    market.marketKind(),
    market.state(),
    market.stakeEndTimestamp(),
    market.resolveAfterTimestamp(),
    market.numOutcomes(),
    market.metadataURI(),
    market.collateralAddress(),
    market.collateralDecimals(),
    market.winningOutcomeIndex(),
    market.redemptionRate(),
    market.umaIdentifier(),
    market.umaLiveness(),
    market.umaReward(),
    market.umaRewardCurrency(),
    market.umaRequestTimestamp(),
  ]);

  const outcomeTokens = await Promise.all(
    Array.from({ length: Number(numOutcomes) }, (_, i) => market.outcomeToken(BigInt(i))),
  );

  const payload = {
    network: networkName,
    chainId,
    deploymentFile: file,
    factory: factoryAddress,
    marketId,
    marketAddress,
    marketKind: Number(marketKind) === 0 ? "PRICE" : "EVENT",
    state: Number(state),
    stateLabel: stateLabel(Number(state)),
    numOutcomes: Number(numOutcomes),
    stakeEndTimestamp: Number(stakeEndTimestamp),
    resolveAfterTimestamp: Number(resolveAfterTimestamp),
    metadataURI: String(metadataURI || ""),
    collateralAddress,
    collateralDecimals: Number(collateralDecimals),
    winningOutcomeIndex: Number(winningOutcomeIndex),
    redemptionRate: redemptionRate.toString(),
    uma: {
      identifier: umaIdentifier,
      liveness: Number(umaLiveness),
      reward: umaReward.toString(),
      rewardCurrency: umaRewardCurrency,
      requestTimestamp: Number(umaRequestTimestamp),
    },
    outcomeTokens,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

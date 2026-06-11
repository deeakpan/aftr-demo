/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function parseCliArgs() {
  const args = process.argv.slice(2);
  let marketIdRaw;
  let network;
  let outcomeIndex;
  let sigsFile;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--network") {
      network = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--outcome") {
      outcomeIndex = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--sigs-file") {
      sigsFile = args[i + 1];
      i += 1;
      continue;
    }
    if (!marketIdRaw) marketIdRaw = arg;
  }

  if (!marketIdRaw) {
    throw new Error(
      "Usage: npm run market:settle -- <id> [--outcome <n> --sigs-file sigs.json] [--network <name>]",
    );
  }
  const id = Number(marketIdRaw);
  if (!Number.isInteger(id) || id < 0) throw new Error(`Invalid market id: ${marketIdRaw}`);
  return { marketId: id, network, outcomeIndex, sigsFile };
}

function readDeployment(hre, networkName, chainId) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`Deployment file not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const factoryAddress = parsed?.contracts?.MondaloreParimutuelMarketFactory;
  if (!factoryAddress || !hre.ethers.isAddress(factoryAddress)) {
    throw new Error("MondaloreParimutuelMarketFactory missing in deployment file.");
  }
  return { factoryAddress, file };
}

async function main() {
  const { marketId, network: networkArg, outcomeIndex, sigsFile } = parseCliArgs();
  if (networkArg) process.env.HARDHAT_NETWORK = networkArg;
  const hre = require("hardhat");
  const [signer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;

  const { factoryAddress, file } = readDeployment(hre, networkName, chainId);
  const factory = await hre.ethers.getContractAt("MondaloreParimutuelMarketFactory", factoryAddress);
  const total = Number(await factory.marketsLength());
  if (marketId >= total) throw new Error(`Market id ${marketId} out of range. Total markets: ${total}`);

  const marketAddress = await factory.markets(BigInt(marketId));
  const market = await hre.ethers.getContractAt("MondaloreVParimutuelMarket", marketAddress);
  const kind = Number(await market.marketKind());
  const state = Number(await market.state());

  console.log("Network:", networkName, chainId);
  console.log("Caller:", signer.address);
  console.log("Deployment:", file);
  console.log("Market id:", marketId);
  console.log("Market:", marketAddress);
  console.log("Kind:", kind === 0 ? "PRICE" : "EVENT");
  console.log("State:", state);

  if (state === 2) {
    const winningOutcomeIndex = await market.winningOutcomeIndex();
    console.log("Market already settled. winningOutcomeIndex:", winningOutcomeIndex.toString());
    return;
  }

  let tx;
  if (kind === 0) {
    if (state !== 0) throw new Error(`Unexpected PRICE market state: ${state}`);
    console.log("Calling settlePrice()...");
    tx = await market.settlePrice();
  } else {
    if (state !== 0) throw new Error(`Unexpected EVENT market state: ${state}`);
    if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0) {
      throw new Error("EVENT markets require --outcome <index> and --sigs-file <path> with 3+ admin signatures.");
    }
    if (!sigsFile || !fs.existsSync(sigsFile)) {
      throw new Error(`Missing signatures file: ${sigsFile}`);
    }
    const raw = JSON.parse(fs.readFileSync(sigsFile, "utf8"));
    const entries = Array.isArray(raw) ? raw : raw.signatures;
    if (!Array.isArray(entries) || entries.length < 3) {
      throw new Error("sigs-file must contain an array of at least 3 { signer, signature } objects.");
    }
    const signers = entries.map((e) => e.signer);
    const signatures = entries.map((e) => e.signature);
    console.log(`Calling resolveEvent(outcome=${outcomeIndex}, ${signers.length} signatures)...`);
    tx = await market.resolveEvent(outcomeIndex, signers, signatures);
  }

  console.log("Submitted:", tx.hash);
  const receipt = await tx.wait();
  console.log("Mined in block:", receipt.blockNumber);

  const newState = Number(await market.state());
  console.log("New state:", newState);
  if (newState === 2) {
    const winningOutcomeIndex = await market.winningOutcomeIndex();
    console.log("winningOutcomeIndex:", winningOutcomeIndex.toString());
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

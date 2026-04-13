/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const OO_ABI = [
  "function proposePriceFor(address requester,address proposer,bytes32 identifier,uint256 timestamp,bytes ancillaryData,int256 proposedPrice) returns (uint256)",
  "function proposePrice(address requester,bytes32 identifier,uint256 timestamp,bytes ancillaryData,int256 proposedPrice) returns (uint256)",
  "function getProposerWhitelistWithEnforcementStatus(address requester,bytes32 identifier,bytes ancillaryData) view returns (bool isEnforced, address[] allowedProposers)",
];

function parseCliArgs() {
  const args = process.argv.slice(2);
  let marketIdRaw;
  let outcomeRaw;
  let network;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--network") {
      network = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--outcome") {
      outcomeRaw = args[i + 1];
      i += 1;
      continue;
    }
    if (!marketIdRaw) marketIdRaw = arg;
  }

  if (!marketIdRaw || !outcomeRaw) {
    throw new Error("Usage: npm run market:propose -- <id> --outcome <index> [--network <name>]");
  }

  const marketId = Number(marketIdRaw);
  const outcomeIndex = Number(outcomeRaw);
  if (!Number.isInteger(marketId) || marketId < 0) throw new Error(`Invalid market id: ${marketIdRaw}`);
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0) throw new Error(`Invalid outcome index: ${outcomeRaw}`);
  return { marketId, outcomeIndex, network };
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

function formatIdentifier(bytes32Hex) {
  try {
    const stripped = bytes32Hex.slice(2);
    const ascii = Buffer.from(stripped, "hex").toString("utf8").replace(/\0+$/, "");
    return ascii || bytes32Hex;
  } catch {
    return bytes32Hex;
  }
}

async function main() {
  const { marketId, outcomeIndex, network: networkArg } = parseCliArgs();
  if (networkArg) process.env.HARDHAT_NETWORK = networkArg;
  const hre = require("hardhat");

  const [signer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;

  const { factoryAddress, file } = readDeployment(hre, networkName, chainId);
  const factory = await hre.ethers.getContractAt("AFTRParimutuelMarketFactory", factoryAddress);
  const total = Number(await factory.marketsLength());
  if (marketId >= total) throw new Error(`Market id ${marketId} out of range. Total markets: ${total}`);

  const marketAddress = await factory.markets(BigInt(marketId));
  const market = await hre.ethers.getContractAt("AFTRVParimutuelMarket", marketAddress);
  const [kind, state, numOutcomes, ooAddress, identifier, ts, ancillary] = await Promise.all([
    market.marketKind(),
    market.state(),
    market.numOutcomes(),
    market.optimisticOracleV2(),
    market.umaIdentifier(),
    market.umaRequestTimestamp(),
    market.umaAncillaryData(),
  ]);

  if (Number(kind) !== 1) throw new Error("Only EVENT markets use UMA proposal flow.");
  if (Number(state) !== 1) throw new Error(`Market is not awaiting UMA proposal. Current state: ${state}`);
  if (outcomeIndex >= Number(numOutcomes)) {
    throw new Error(`Outcome index ${outcomeIndex} out of range (numOutcomes=${numOutcomes}).`);
  }
  if (BigInt(ts) === 0n) throw new Error("umaRequestTimestamp is 0. Run market:settle once first to request resolution.");

  const YES_NO = hre.ethers.encodeBytes32String("YES_OR_NO_QUERY");
  const proposedPrice = identifier === YES_NO ? (outcomeIndex === 0 ? 10n ** 18n : 0n) : BigInt(outcomeIndex);

  const oo = new hre.ethers.Contract(ooAddress, OO_ABI, signer);

  console.log("Network:", networkName, chainId);
  console.log("Signer:", signer.address);
  console.log("Deployment:", file);
  console.log("Factory:", factoryAddress);
  console.log("Market id:", marketId);
  console.log("Market:", marketAddress);
  console.log("OOv2:", ooAddress);
  console.log("Identifier:", formatIdentifier(identifier), `(${identifier})`);
  console.log("Request timestamp:", ts.toString());
  console.log("Outcome index:", outcomeIndex);
  console.log("Proposed price:", proposedPrice.toString());

  try {
    const [isEnforced, allowed] = await oo.getProposerWhitelistWithEnforcementStatus(
      marketAddress,
      identifier,
      ancillary,
    );
    console.log("Whitelist enforced:", isEnforced);
    if (isEnforced) {
      const allowedLower = allowed.map((a) => a.toLowerCase());
      const ok = allowedLower.includes(signer.address.toLowerCase());
      console.log("Signer whitelisted:", ok);
      if (!ok) {
        throw new Error("Signer is not on proposer whitelist for this request.");
      }
    }
  } catch (e) {
    console.log("Whitelist check unavailable on this OO deployment, continuing...");
    if (e instanceof Error && e.message.includes("not on proposer whitelist")) throw e;
  }

  let tx;
  try {
    tx = await oo.proposePriceFor(marketAddress, signer.address, identifier, ts, ancillary, proposedPrice);
  } catch {
    tx = await oo.proposePrice(marketAddress, identifier, ts, ancillary, proposedPrice);
  }
  console.log("Submitted:", tx.hash);
  const receipt = await tx.wait();
  console.log("Mined in block:", receipt.blockNumber);
  console.log("Proposal submitted. After liveness/dispute window, run market:settle again to finalize.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

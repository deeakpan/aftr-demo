/* eslint-disable no-console */
/**
 * Sign an EVENT market resolution as a factory resolution admin.
 *
 * Usage:
 *   npm run market:sign-resolution -- <marketAddress> --outcome <index> [--network monadTestnet]
 *
 * Env: PRIVATE_KEY (must be a factory resolution admin)
 */
const path = require("path");
const { signResolution } = require("./lib/event-resolution-eip712.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function parseArgs() {
  const args = process.argv.slice(2);
  let market;
  let outcome;
  let network;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--network") {
      network = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--outcome") {
      outcome = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (!market) market = a;
  }
  if (!market || !Number.isInteger(outcome) || outcome < 0) {
    throw new Error("Usage: npm run market:sign-resolution -- <market> --outcome <index> [--network <name>]");
  }
  return { market, outcome, network };
}

async function main() {
  const { market, outcome, network } = parseArgs();
  if (network) process.env.HARDHAT_NETWORK = network;
  const hre = require("hardhat");
  const [signer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  const sig = await signResolution(signer, market, outcome, chainId);
  const out = {
    market,
    outcomeIndex: outcome,
    chainId,
    signer: signer.address,
    signature: sig,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

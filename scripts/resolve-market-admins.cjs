/* eslint-disable no-console */
/**
 * One-shot EVENT resolution: sign outcome 0 (or --outcome N) with factory admin keys
 * from wallets.json / env, then submit resolveEvent on-chain. No Supabase.
 *
 * Usage:
 *   npm run market:resolve-admins -- [marketId] [--outcome 0] [--network monadTestnet] [--dry-run]
 *
 * Keys (must match factory resolutionAdmins):
 *   - wallets.json (first admins used for signing)
 *   - PRIVATE_KEY, SECOND_PRIVATE_KEY, ADMIN_PRIVATE_KEYS (comma-separated)
 */
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");
const { signResolution } = require("./lib/event-resolution-eip712.cjs");
const { WALLETS_PATH } = require("./lib/aftr-scripts-lib.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const FACTORY_ABI = [
  "function marketsLength() view returns (uint256)",
  "function markets(uint256) view returns (address)",
  "function isResolutionAdmin(address) view returns (bool)",
  "function resolutionThreshold() view returns (uint256)",
];

const MARKET_ABI = [
  "function marketKind() view returns (uint8)",
  "function state() view returns (uint8)",
  "function resolveAfterTimestamp() view returns (uint256)",
  "function resolveEvent(uint8 outcomeIndex, address[] signers, bytes[] signatures)",
];

function normalizePrivateKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return s.startsWith("0x") ? s : `0x${s}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let marketId = 0;
  let outcome = 0;
  let network;
  let dryRun = false;

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
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (/^\d+$/.test(a) && marketId === 0 && args.indexOf(a) === 0) {
      marketId = Number(a);
      continue;
    }
    if (/^\d+$/.test(a)) {
      marketId = Number(a);
    }
  }

  if (!Number.isInteger(outcome) || outcome < 0) {
    throw new Error("--outcome must be a non-negative integer");
  }
  if (!Number.isInteger(marketId) || marketId < 0) {
    throw new Error("marketId must be a non-negative integer");
  }

  return { marketId, outcome, network, dryRun };
}

function readDeployment(hre, networkName, chainId) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`Deployment file not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const factoryAddress = parsed?.contracts?.MondaloreParimutuelMarketFactory;
  if (!factoryAddress || !hre.ethers.isAddress(factoryAddress)) {
    throw new Error("MondaloreParimutuelMarketFactory missing in deployment file.");
  }
  return { parsed, factoryAddress, file };
}

function loadAdminPrivateKeys(deployment) {
  const adminSet = new Set(
    (deployment.resolutionAdmins ?? []).map((a) => String(a).toLowerCase()),
  );
  const entries = [];
  const seenPk = new Set();

  function addKey(raw, source) {
    const pk = normalizePrivateKey(raw);
    if (!pk || seenPk.has(pk)) return;
    const wallet = new Wallet(pk);
    if (adminSet.size > 0 && !adminSet.has(wallet.address.toLowerCase())) {
      return;
    }
    seenPk.add(pk);
    entries.push({ privateKey: pk, address: wallet.address, source });
  }

  for (const envName of ["PRIVATE_KEY", "SECOND_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]) {
    if (process.env[envName]) addKey(process.env[envName], envName);
  }
  if (process.env.ADMIN_PRIVATE_KEYS?.trim()) {
    for (const part of process.env.ADMIN_PRIVATE_KEYS.split(",")) {
      addKey(part.trim(), "ADMIN_PRIVATE_KEYS");
    }
  }

  if (fs.existsSync(WALLETS_PATH)) {
    const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
    for (const w of data.wallets ?? []) {
      if (w.privateKey) addKey(w.privateKey, "wallets.json");
    }
  }

  return entries;
}

async function main() {
  const { marketId, outcome, network: networkArg, dryRun } = parseArgs();
  if (networkArg) process.env.HARDHAT_NETWORK = networkArg;
  const hre = require("hardhat");
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;

  const { parsed: deployment, factoryAddress, file } = readDeployment(hre, networkName, chainId);
  const factory = new hre.ethers.Contract(factoryAddress, FACTORY_ABI, hre.ethers.provider);
  const threshold = Number(await factory.resolutionThreshold());

  const total = Number(await factory.marketsLength());
  if (marketId >= total) {
    throw new Error(`Market id ${marketId} out of range (total ${total}).`);
  }

  const marketAddress = await factory.markets(BigInt(marketId));
  const marketRead = new hre.ethers.Contract(marketAddress, MARKET_ABI, hre.ethers.provider);
  const [kind, state, resolveAfter] = await Promise.all([
    marketRead.marketKind(),
    marketRead.state(),
    marketRead.resolveAfterTimestamp(),
  ]);

  const kindNum = Number(kind);
  const stateNum = Number(state);
  const now = Math.floor(Date.now() / 1000);

  console.log("Network:", networkName, chainId);
  console.log("Deployment:", file);
  console.log("Factory:", factoryAddress);
  console.log("Market id:", marketId);
  console.log("Market:", marketAddress);
  console.log("Kind:", kindNum === 0 ? "PRICE" : "EVENT");
  console.log("State:", stateNum === 0 ? "OPEN" : stateNum === 2 ? "SETTLED" : stateNum);
  console.log("Outcome index:", outcome);
  console.log("Resolution threshold:", threshold);

  if (kindNum !== 1) {
    throw new Error(
      `Market #${marketId} is not an EVENT market. Admin signatures only apply to EVENT markets. ` +
        `For PRICE markets use: npm run market:settle -- ${marketId}`,
    );
  }
  if (stateNum === 2) {
    console.log("Already settled.");
    return;
  }
  if (stateNum !== 0) {
    throw new Error(`Unexpected market state: ${stateNum}`);
  }
  if (now < Number(resolveAfter)) {
    throw new Error(
      `Too early — resolveAfter is ${resolveAfter} (${new Date(Number(resolveAfter) * 1000).toISOString()}).`,
    );
  }

  const keyEntries = loadAdminPrivateKeys(deployment);
  if (keyEntries.length === 0) {
    throw new Error("No admin private keys found (wallets.json or env).");
  }

  const verifiedAdmins = [];
  for (const entry of keyEntries) {
    const ok = await factory.isResolutionAdmin(entry.address);
    if (!ok) {
      console.warn(`Skip ${entry.address} (${entry.source}) — not a factory resolution admin`);
      continue;
    }
    verifiedAdmins.push(entry);
  }

  if (verifiedAdmins.length < threshold) {
    throw new Error(
      `Need at least ${threshold} resolution admin keys; only ${verifiedAdmins.length} verified.`,
    );
  }

  const signersToUse = verifiedAdmins.slice(0, threshold);
  const signatures = [];
  const signers = [];

  console.log("\nSigning EIP-712 EventResolution payloads...");
  for (const admin of signersToUse) {
    const wallet = new Wallet(admin.privateKey, hre.ethers.provider);
    const sig = await signResolution(wallet, marketAddress, outcome, chainId);
    signers.push(wallet.address);
    signatures.push(sig);
    console.log(`  ✓ ${wallet.address} (${admin.source})`);
  }

  const payload = {
    marketId,
    market: marketAddress,
    outcomeIndex: outcome,
    chainId,
    signers,
    signatures,
  };

  console.log("\nSignatures (local only — not stored in Supabase):");
  console.log(JSON.stringify(payload, null, 2));

  if (dryRun) {
    console.log("\n--dry-run: skipping on-chain resolveEvent.");
    return;
  }

  const provider = hre.ethers.provider;
  const submitterCandidates = [];

  for (const envName of ["PRIVATE_KEY", "SECOND_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]) {
    const pk = normalizePrivateKey(process.env[envName]);
    if (pk) submitterCandidates.push({ pk, source: envName });
  }
  for (const admin of signersToUse) {
    submitterCandidates.push({ pk: admin.privateKey, source: `${admin.address} (admin)` });
  }

  let submitter = null;
  for (const cand of submitterCandidates) {
    const w = new Wallet(cand.pk, provider);
    const bal = await provider.getBalance(w.address);
    if (bal > 0n) {
      submitter = w;
      console.log(`\nSubmitter: ${w.address} (${cand.source}, balance ${hre.ethers.formatEther(bal)} MON)`);
      break;
    }
  }
  if (!submitter) {
    throw new Error("No funded wallet found to pay gas for resolveEvent.");
  }

  const marketWrite = new hre.ethers.Contract(marketAddress, MARKET_ABI, submitter);

  console.log("Submitting resolveEvent...");
  const tx = await marketWrite.resolveEvent(outcome, signers, signatures);
  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Mined in block:", receipt.blockNumber);

  const newState = Number(await marketRead.state());
  console.log("New state:", newState === 2 ? "SETTLED" : newState);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});

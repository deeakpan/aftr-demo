/* eslint-disable no-console */
/**
 * UMA IdentifierWhitelist
 *
 * What address: the IdentifierWhitelist on the SAME chain as OO (see AFTRUmaAddresses.IDENTIFIER_WHITELIST).
 * There is no "getAllIdentifiers()" — only isIdentifierSupported(bytes32), or log scan / subgraph.
 *
 *   CHAIN_ID=84532 BASE_RPC_URL=https://sepolia.base.org npm run uma:identifiers
 *   CHAIN_ID=84532 BASE_RPC_URL=https://sepolia.base.org npm run uma:check-identifier -- YES_OR_NO_QUERY
 *
 * Default whitelist address matches AFTRUmaAddresses (Base Sepolia). For Base mainnet use another RPC + IDENTIFIER_WHITELIST.
 */
require("dotenv").config();
const { createPublicClient, http, parseAbi, decodeEventLog, pad, stringToHex } = require("viem");
const { base, baseSepolia } = require("viem/chains");

const DEFAULT_WHITELIST = "0x4da2fD75dd26A8C8A0a8Db892019651344705836";

const EVENT_ABI = parseAbi([
  "event SupportedIdentifierAdded(bytes32 indexed identifier)",
  "event SupportedIdentifierRemoved(bytes32 indexed identifier)",
]);

const READ_ABI = parseAbi([
  "function isIdentifierSupported(bytes32 identifier) view returns (bool)",
  ...EVENT_ABI,
]);

function bytes32ToAsciiLabel(hexBytes32) {
  try {
    const hex = hexBytes32.slice(2);
    const bytes = Buffer.from(hex, "hex");
    const end = bytes.indexOf(0);
    const slice = end === -1 ? bytes : bytes.subarray(0, end);
    if (slice.length === 0) return null;
    for (const b of slice) {
      if (b < 32 || b > 126) return null;
    }
    return slice.toString("utf8");
  } catch {
    return null;
  }
}

function makeClient(rpc) {
  const chainIdEnv = process.env.CHAIN_ID;
  const chain =
    chainIdEnv === "84532" ? baseSepolia : chainIdEnv === "8453" ? base : undefined;
  return createPublicClient({
    ...(chain ? { chain } : {}),
    transport: http(rpc),
  });
}

async function main() {
  const rpc = process.env.BASE_RPC_URL || process.env.RPC_URL;
  if (!rpc) {
    console.error("Set BASE_RPC_URL or RPC_URL.");
    process.exitCode = 1;
    return;
  }

  const whitelistAddr = process.env.IDENTIFIER_WHITELIST || DEFAULT_WHITELIST;
  const client = makeClient(rpc);
  const cid = await client.getChainId();
  console.log("Chain ID:", cid);
  console.log("IdentifierWhitelist:", whitelistAddr);

  const mode = process.argv[2] === "check" ? "check" : "scan";
  if (mode === "check") {
    const raw = process.argv[3];
    if (!raw) {
      console.error('Usage: npm run uma:check-identifier -- YES_OR_NO_QUERY');
      process.exitCode = 1;
      return;
    }
    const b32 =
      raw.startsWith("0x") && raw.length === 66
        ? (raw)
        : pad(stringToHex(raw.length > 31 ? raw.slice(0, 31) : raw), { size: 32 });
    const ok = await client.readContract({
      address: whitelistAddr,
      abi: READ_ABI,
      functionName: "isIdentifierSupported",
      args: [b32],
    });
    console.log("Identifier:", b32);
    console.log("isIdentifierSupported:", ok);
    return;
  }

  const latest = await client.getBlockNumber();
  const fromBlock = BigInt(process.env.SCAN_FROM_BLOCK || "0");
  const toBlock = BigInt(process.env.SCAN_TO_BLOCK || latest.toString());
  const chunk = BigInt(process.env.SCAN_CHUNK || "2000");

  const added = new Set();
  const removed = new Set();

  console.log(`Scanning ${fromBlock} → ${toBlock} (chunk ${chunk})…`);

  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n;
    const logsA = await client.getLogs({
      address: whitelistAddr,
      event: EVENT_ABI[0],
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logsA) {
      const d = decodeEventLog({ abi: EVENT_ABI, data: log.data, topics: log.topics });
      added.add(d.args.identifier);
    }
    const logsR = await client.getLogs({
      address: whitelistAddr,
      event: EVENT_ABI[1],
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logsR) {
      const d = decodeEventLog({ abi: EVENT_ABI, data: log.data, topics: log.topics });
      removed.add(d.args.identifier);
    }
    process.stdout.write(`\r${start}–${end} / ${toBlock}`);
  }
  console.log();

  const supported = [...added].filter((id) => !removed.has(id));
  console.log("Supported count:", supported.length);
  for (const h of supported.sort()) {
    const label = bytes32ToAsciiLabel(h);
    console.log(h, label ? `"${label}"` : "(opaque)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

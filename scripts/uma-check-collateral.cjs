/* eslint-disable no-console */
/**
 * Check if an ERC20 is on UMA’s collateral AddressWhitelist for your chain.
 * OO reward/bond currency usually must be whitelisted (plus Store final fee, etc.).
 *
 *   CHAIN_ID=84532 BASE_RPC_URL=https://sepolia.base.org npm run uma:check-collateral -- 0xYourToken
 *
 * Env: ADDRESS_WHITELIST (default: AFTRUmaAddresses on Base Sepolia)
 */
require("dotenv").config();
const { createPublicClient, http, parseAbi, isAddress } = require("viem");
const { baseSepolia, base } = require("viem/chains");

// contracts/config/AFTRUmaAddresses.sol
const DEFAULT_WHITELIST = "0xF2D5614BD8D6246AACa5a6841aCfCA210B0CbC19";

const WHITELIST_ABI = parseAbi([
  "function isOnWhitelist(address newElement) view returns (bool)",
]);

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
  const token = process.argv[2];
  if (!rpc || !token || !isAddress(token)) {
    console.error("Usage: BASE_RPC_URL=... CHAIN_ID=84532 npm run uma:check-collateral -- <tokenAddress>");
    process.exitCode = 1;
    return;
  }

  const whitelist = (process.env.ADDRESS_WHITELIST || DEFAULT_WHITELIST).toLowerCase();
  const client = makeClient(rpc);
  console.log("Chain ID:", await client.getChainId());
  console.log("AddressWhitelist:", whitelist);
  console.log("Token:", token);

  const ok = await client.readContract({
    address: whitelist,
    abi: WHITELIST_ABI,
    functionName: "isOnWhitelist",
    args: [token],
  });

  console.log("isOnWhitelist:", ok);
  if (!ok) {
    console.log(
      "\nNot on UMA collateral whitelist — requestPrice / bonds may revert. Use a listed token or get yours added.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

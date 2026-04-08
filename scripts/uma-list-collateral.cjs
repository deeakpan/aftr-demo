/* eslint-disable no-console */
/**
 * List addresses on UMA’s collateral AddressWhitelist (active only).
 *
 *   CHAIN_ID=84532 BASE_RPC_URL=https://sepolia.base.org npm run uma:list-collateral
 */
require("dotenv").config();
const { createPublicClient, http, parseAbi } = require("viem");
const { baseSepolia, base } = require("viem/chains");

const DEFAULT_WHITELIST = "0xF2D5614BD8D6246AACa5a6841aCfCA210B0CbC19";

const ABI = parseAbi([
  "function getWhitelist() view returns (address[] activeWhitelist)",
]);

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
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
  if (!rpc) {
    console.error("Set BASE_RPC_URL or RPC_URL.");
    process.exitCode = 1;
    return;
  }

  const whitelist = process.env.ADDRESS_WHITELIST || DEFAULT_WHITELIST;
  const client = makeClient(rpc);
  console.log("Chain ID:", await client.getChainId());
  console.log("AddressWhitelist:", whitelist);
  console.log("");

  const addrs = await client.readContract({
    address: whitelist,
    abi: ABI,
    functionName: "getWhitelist",
  });

  console.log("Count:", addrs.length);
  for (const a of addrs) {
    let extra = "";
    try {
      const [sym, dec] = await Promise.all([
        client.readContract({ address: a, abi: ERC20_ABI, functionName: "symbol" }),
        client.readContract({ address: a, abi: ERC20_ABI, functionName: "decimals" }),
      ]);
      extra = `  ${sym} (${dec} decimals)`;
    } catch {
      extra = "  (not ERC20 symbol/decimals)";
    }
    console.log(a + extra);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

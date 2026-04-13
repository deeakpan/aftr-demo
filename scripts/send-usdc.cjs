/* eslint-disable no-console */
/**
 * Send a fixed amount of ERC20 (defaults to deployment AFTRUSDC on Base Sepolia) to a recipient.
 *
 * Env:
 *   PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) — hex, with or without 0x
 *   BASE_SEPOLIA_RPC_URL — optional, defaults to https://sepolia.base.org
 *   SEND_USDC_TOKEN — optional ERC20 address override (e.g. Circle test USDC from deployment external)
 *
 * Usage:
 *   node scripts/send-usdc.cjs
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createPublicClient, createWalletClient, http, parseAbi, parseUnits } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");

const DEFAULT_RECIPIENT = "0x75B51D8Bd0c99201Eee9C0E0954B788fF0fD9B38";
const SEND_AMOUNT = "500";

const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

function normalizePrivateKey(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  return s.startsWith("0x") ? s : `0x${s}`;
}

function readDefaultTokenAddress() {
  const deploymentPath = path.join(__dirname, "..", "deployments", "baseSepolia-84532.json");
  const j = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const addr = j?.contracts?.AFTRUSDC;
  if (!addr || typeof addr !== "string") {
    throw new Error("AFTRUSDC missing in deployments/baseSepolia-84532.json");
  }
  return addr;
}

async function main() {
  const pk = normalizePrivateKey(process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY);
  if (!pk) {
    throw new Error("Set PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in .env (project root).");
  }

  const recipient = (process.env.SEND_USDC_TO || DEFAULT_RECIPIENT).trim();
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const tokenAddress = (process.env.SEND_USDC_TOKEN || readDefaultTokenAddress()).trim();

  const account = privateKeyToAccount(pk);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });

  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "symbol",
    }).catch(() => "?"),
  ]);

  const amountWei = parseUnits(SEND_AMOUNT, Number(decimals));
  const bal = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  console.log(`From:     ${account.address}`);
  console.log(`Token:    ${tokenAddress} (${symbol}, ${decimals} decimals)`);
  console.log(`Balance:  ${bal.toString()} raw`);
  console.log(`To:       ${recipient}`);
  console.log(`Amount:   ${SEND_AMOUNT} ${symbol}`);

  if (bal < amountWei) {
    throw new Error(`Insufficient balance: need ${amountWei.toString()} raw, have ${bal.toString()}.`);
  }

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipient, amountWei],
    account,
  });
  console.log(`Submitted: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}, status ${receipt.status}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

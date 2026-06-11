/* eslint-disable no-console */
/**
 * Send MondaloreUSDC (deployment `contracts.MondaloreUSDC`; on-chain symbol is USDC) from PRIVATE_KEY → recipient (Base Sepolia).
 *
 * Env:
 *   PRIVATE_KEY or DEPLOYER_PRIVATE_KEY
 *   BASE_SEPOLIA_RPC_URL / RPC_URL — optional
 *   SEND_RECIPIENT — optional override (checksum not required)
 *   SEND_AMOUNT — optional human amount; default "10000"
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createPublicClient, createWalletClient, http, parseAbi, parseEther, parseUnits } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");

const DEFAULT_RECIPIENT = "0x68ac96Ce64D62386b1A5E2DFf8f0F01fEEd46E09";
const DEFAULT_SEND_AMOUNT = "10000";
/** Enough for one erc20 tx on Sepolia-ish L2. */
const MIN_NATIVE_FOR_GAS = parseEther("0.000002");

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

function readAftrAddress() {
  const deploymentPath = path.join(__dirname, "..", "deployments", "baseSepolia-84532.json");
  const j = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const addr = j?.contracts?.MondaloreUSDC;
  if (!addr || typeof addr !== "string") throw new Error("MondaloreUSDC missing in deployments/baseSepolia-84532.json");
  return addr;
}

async function main() {
  const pk = normalizePrivateKey(process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY);
  if (!pk) throw new Error("Set PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in .env");

  const recipientRaw = (process.env.SEND_RECIPIENT || DEFAULT_RECIPIENT).trim();
  const recipient = recipientRaw.toLowerCase();
  if (!recipient.startsWith("0x") || recipient.length !== 42) {
    throw new Error(`Invalid recipient: ${recipient}`);
  }
  const recipientAddr = /** @type {`0x${string}`} */ (recipient);

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_URL || "https://sepolia.base.org";
  const amountHuman = process.env.SEND_AMOUNT || DEFAULT_SEND_AMOUNT;
  const tokenAddress = readAftrAddress();

  const account = privateKeyToAccount(pk);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });

  const nativeBal = await publicClient.getBalance({ address: account.address });
  const decimals = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
  });
  const symbol = await publicClient
    .readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "symbol" })
    .catch(() => "USDC");
  const tokenWei = parseUnits(amountHuman, Number(decimals));
  const tokenBal = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  console.log(`From:       ${account.address}`);
  console.log(`Recipient:  ${recipientAddr}`);
  console.log(`Token:      ${symbol} (${tokenAddress})`);
  console.log(`RPC:        ${rpcUrl}`);
  console.log(`Native bal: ${nativeBal.toString()} wei`);
  console.log(`Send:       ${amountHuman} ${symbol}`);

  if (nativeBal < MIN_NATIVE_FOR_GAS) {
    throw new Error(`Need at least ~${MIN_NATIVE_FOR_GAS} wei ETH for gas, have ${nativeBal}.`);
  }
  if (tokenBal < tokenWei) {
    throw new Error(`Insufficient balance: need ${tokenWei.toString()} raw, have ${tokenBal.toString()}.`);
  }

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipientAddr, tokenWei],
    account,
    chain: baseSepolia,
  });
  console.log(`TX: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Done — block ${receipt.blockNumber} status ${receipt.status}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

/* eslint-disable no-console */
/**
 * Send fixed native ETH + AFTRUSDC to a recipient from PRIVATE_KEY (Base Sepolia).
 *
 * Env:
 *   PRIVATE_KEY or DEPLOYER_PRIVATE_KEY
 *   BASE_SEPOLIA_RPC_URL — optional, defaults to https://sepolia.base.org
 *   SEND_RECIPIENT — optional (default hardcoded test recipient)
 *   SEND_ETH_AMOUNT — optional ether string; default "0.01"
 *   SEND_AFTR_AMOUNT — optional; default "10000" (human, 6 decimals)
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  parseUnits,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");

const DEFAULT_RECIPIENT = "0x48Cc6C8FD526dBa669c54F7cC674C3237Ba8Fb4A";
const ETH_SEND = "0.01";
const AFTR_HUMAN = "10000";

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
  const addr = j?.contracts?.AFTRUSDC;
  if (!addr || typeof addr !== "string") throw new Error("AFTRUSDC missing in deployments/baseSepolia-84532.json");
  return addr;
}

async function main() {
  const pk = normalizePrivateKey(process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY);
  if (!pk) throw new Error("Set PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in .env");

  const recipient = (process.env.SEND_RECIPIENT || DEFAULT_RECIPIENT).trim().toLowerCase();
  if (!recipient.startsWith("0x") || recipient.length !== 42) {
    throw new Error(`Invalid recipient: ${recipient}`);
  }
  const recipientAddr = /** @type {`0x${string}`} */ (recipient);

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_URL || "https://sepolia.base.org";
  const ethAmount = parseEther(process.env.SEND_ETH_AMOUNT || ETH_SEND);
  const aftrHuman = process.env.SEND_AFTR_AMOUNT || AFTR_HUMAN;
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
  const aftrWei = parseUnits(aftrHuman, Number(decimals));
  const tokenBal = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  console.log(`From:       ${account.address}`);
  console.log(`Recipient:  ${recipientAddr}`);
  console.log(`RPC:        ${rpcUrl}`);
  console.log(`Native bal: ${nativeBal.toString()} wei`);
  console.log(`Will send:  ${ETH_SEND} ETH + ${aftrHuman} ${symbol} (${tokenAddress})`);

  /** Leave headroom for gas on the second tx (rough). */
  const minNative = ethAmount + parseEther("0.00005");
  if (nativeBal < minNative) {
    throw new Error(`Insufficient ETH: need at least ~${minNative.toString()} wei, have ${nativeBal.toString()}.`);
  }
  if (tokenBal < aftrWei) {
    throw new Error(`Insufficient ${symbol}: need ${aftrWei.toString()} raw, have ${tokenBal.toString()}.`);
  }

  const ethHash = await walletClient.sendTransaction({
    to: recipientAddr,
    value: ethAmount,
    account,
    chain: baseSepolia,
  });
  console.log(`ETH tx:     ${ethHash}`);
  const ethReceipt = await publicClient.waitForTransactionReceipt({ hash: ethHash });
  console.log(`ETH done:   block ${ethReceipt.blockNumber} status ${ethReceipt.status}`);

  const erc20Hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipientAddr, aftrWei],
    account,
    chain: baseSepolia,
  });
  console.log(`${symbol} tx:  ${erc20Hash}`);
  const erc20Receipt = await publicClient.waitForTransactionReceipt({ hash: erc20Hash });
  console.log(`${symbol} done:  block ${erc20Receipt.blockNumber} status ${erc20Receipt.status}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

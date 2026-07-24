/* eslint-disable no-console */
/**
 * Send MondaloreUSDC (test USDC) on Monad Testnet.
 *
 * Env:
 *   PRIVATE_KEY — sender
 *   RPC_URL — optional
 *   SEND_USDC_TO — recipient override
 *   SEND_USDC_AMOUNT — amount as human string (default 500)
 *
 * Usage:
 *   npm run send:usdc -- 0xRecipient
 *   npm run send:usdc -- 0xRecipient 100
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createPublicClient, createWalletClient, http, parseAbi, parseUnits, isAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { defineChain } = require("viem");

const DEFAULT_AMOUNT = "500";

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

function normalizePrivateKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return s.startsWith("0x") ? s : `0x${s}`;
}

function readUsdcAddress() {
  const deploymentPath = path.join(__dirname, "..", "deployments", "monadTestnet-10143.json");
  const j = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const addr = j?.contracts?.MondaloreUSDC;
  if (!addr || typeof addr !== "string") {
    throw new Error("MondaloreUSDC missing in deployments/monadTestnet-10143.json");
  }
  return addr;
}

async function main() {
  const pk = normalizePrivateKey(process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY);
  if (!pk) {
    throw new Error("Set PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in .env (project root).");
  }

  const cliRecipient = process.argv[2]?.trim();
  const cliAmount = process.argv[3]?.trim();
  const recipient = (cliRecipient || process.env.SEND_USDC_TO || "").trim();
  const amountStr = (cliAmount || process.env.SEND_USDC_AMOUNT || DEFAULT_AMOUNT).trim();

  if (!recipient || !isAddress(recipient)) {
    throw new Error("Pass a valid recipient: npm run send:usdc -- 0x...");
  }

  const rpcUrl = process.env.RPC_URL?.trim() || "https://testnet-rpc.monad.xyz/";
  const tokenAddress = (process.env.SEND_USDC_TOKEN || readUsdcAddress()).trim();

  const account = privateKeyToAccount(pk);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: monadTestnet, transport });
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport });

  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    publicClient
      .readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "symbol",
      })
      .catch(() => "USDC"),
  ]);

  const amountWei = parseUnits(amountStr, Number(decimals));
  const bal = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  console.log(`Network:  Monad Testnet (${monadTestnet.id})`);
  console.log(`From:     ${account.address}`);
  console.log(`Token:    ${tokenAddress} (${symbol}, ${decimals} decimals)`);
  console.log(`Balance:  ${bal.toString()} raw`);
  console.log(`To:       ${recipient}`);
  console.log(`Amount:   ${amountStr} ${symbol}`);

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
  console.log(`Explorer: https://testnet.monadvision.com/tx/${hash}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

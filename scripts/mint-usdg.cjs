/* eslint-disable no-console */
/**
 * Mint USDG to a recipient (owner-only). Reads token from deployment JSON.
 *
 * Env: PRIVATE_KEY or DEPLOYER_PRIVATE_KEY, RPC_URL (optional)
 *
 * Usage:
 *   npm run mint:usdg -- 0xRecipient 5000
 *   MINT_USDG_TO=0x... MINT_USDG_AMOUNT=10000 npm run mint:usdg
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createPublicClient, createWalletClient, http, parseAbi, parseUnits, isAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const CHAINS = {
  10143: {
    id: 10143,
    name: "Monad Testnet",
    rpc: process.env.RPC_URL?.trim() || "https://testnet-rpc.monad.xyz",
    deployment: "monadTestnet-10143.json",
  },
  4663: {
    id: 4663,
    name: "Robinhood Chain",
    rpc: process.env.RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com",
    deployment: "robinhoodMainnet-4663.json",
  },
};

const MINT_ABI = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function owner() view returns (address)",
]);

function normalizePrivateKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return s.startsWith("0x") ? s : `0x${s}`;
}

function readUsdgAddress(depFile) {
  const deploymentPath = path.join(__dirname, "..", "deployments", depFile);
  const j = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const addr = j?.contracts?.USDG || j?.external?.pons?.usdg;
  if (!addr || typeof addr !== "string" || /^0x0+$/i.test(addr)) {
    throw new Error(`USDG missing in ${depFile}. Run: npx hardhat run scripts/deploy-usdg.cjs --network ...`);
  }
  return addr.trim();
}

async function main() {
  const pk = normalizePrivateKey(process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY);
  if (!pk) throw new Error("Set PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in .env");

  const chainId = Number(process.env.CHAIN_ID?.trim() || "10143");
  const chainMeta = CHAINS[chainId];
  if (!chainMeta) throw new Error(`Unsupported CHAIN_ID ${chainId}`);

  const cliRecipient = process.argv[2]?.trim();
  const cliAmount = process.argv[3]?.trim();
  const recipient = (cliRecipient || process.env.MINT_USDG_TO || "").trim();
  const amountStr = (cliAmount || process.env.MINT_USDG_AMOUNT || "10000").trim();

  if (!recipient || !isAddress(recipient)) {
    throw new Error("Pass recipient: npm run mint:usdg -- 0xRecipient [amount]");
  }

  const tokenAddress = (process.env.USDG_ADDRESS || readUsdgAddress(chainMeta.deployment)).trim();
  const account = privateKeyToAccount(pk);
  const chain = {
    id: chainMeta.id,
    name: chainMeta.name,
    nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [chainMeta.rpc] } },
  };
  const transport = http(chainMeta.rpc);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  const [decimals, owner] = await Promise.all([
    publicClient.readContract({ address: tokenAddress, abi: MINT_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: tokenAddress, abi: MINT_ABI, functionName: "owner" }),
  ]);

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Signer ${account.address} is not USDG owner (${owner})`);
  }

  const amountWei = parseUnits(amountStr, Number(decimals));
  console.log(`Network:  ${chainMeta.name} (${chainId})`);
  console.log(`USDG:     ${tokenAddress}`);
  console.log(`Mint to:  ${recipient}`);
  console.log(`Amount:   ${amountStr} USDG`);

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: MINT_ABI,
    functionName: "mint",
    args: [recipient, amountWei],
    account,
  });
  console.log(`Submitted: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const bal = await publicClient.readContract({
    address: tokenAddress,
    abi: MINT_ABI,
    functionName: "balanceOf",
    args: [recipient],
  });
  console.log(`Confirmed block ${receipt.blockNumber}; recipient balance ${bal.toString()} raw`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

/* eslint-disable no-console */
/**
 * Generate 10 wallets, fund each with >=50 AFTRUSDC and a small ETH gas stipend.
 * Writes wallets.json at repo root (gitignored).
 *
 * Env: PRIVATE_KEY or DEPLOYER_PRIVATE_KEY, RPC_URL, optional WALLET_COUNT (default 10)
 */
const {
  generatePrivateKey,
  privateKeyToAccount,
} = require("viem/accounts");
const { parseEther, parseUnits } = require("viem");

const {
  ERC20_ABI,
  getFunderClients,
  readDeployment,
  saveWalletsFile,
  WALLETS_PATH,
} = require("./lib/aftr-scripts-lib.cjs");

const DEFAULT_COUNT = 10;
const USDC_PER_WALLET = "55";
const ETH_PER_WALLET = parseEther("0.00015");

async function main() {
  const count = Number(process.env.WALLET_COUNT || DEFAULT_COUNT);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("WALLET_COUNT must be an integer between 1 and 50");
  }

  const deployment = readDeployment();
  const usdcAddress = deployment.contracts.AFTRUSDC;
  if (!usdcAddress) throw new Error("AFTRUSDC missing in deployment file");

  const { account: funder, publicClient, walletClient } = getFunderClients();
  const decimals = await publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
  });
  const usdcWei = parseUnits(USDC_PER_WALLET, Number(decimals));
  const totalUsdc = usdcWei * BigInt(count);
  const totalEth = ETH_PER_WALLET * BigInt(count);

  const [nativeBal, tokenBal] = await Promise.all([
    publicClient.getBalance({ address: funder.address }),
    publicClient.readContract({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [funder.address],
    }),
  ]);

  console.log(`Funder: ${funder.address}`);
  console.log(`Creating ${count} wallets → ${WALLETS_PATH}`);
  console.log(`Per wallet: ${USDC_PER_WALLET} USDC, ${ETH_PER_WALLET} wei ETH`);

  if (tokenBal < totalUsdc) {
    throw new Error(`Funder needs ${totalUsdc} USDC raw, has ${tokenBal}`);
  }
  if (nativeBal < totalEth + parseEther("0.001")) {
    throw new Error(`Funder needs more ETH for transfers + gas`);
  }

  const wallets = [];
  for (let i = 0; i < count; i += 1) {
    const privateKey = generatePrivateKey();
    const child = privateKeyToAccount(privateKey);
    wallets.push({ address: child.address, privateKey });

    console.log(`[${i + 1}/${count}] Funding ${child.address}...`);

    const ethHash = await walletClient.sendTransaction({
      account: funder,
      to: child.address,
      value: ETH_PER_WALLET,
    });
    await publicClient.waitForTransactionReceipt({ hash: ethHash });

    const usdcHash = await walletClient.writeContract({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [child.address, usdcWei],
      account: funder,
    });
    await publicClient.waitForTransactionReceipt({ hash: usdcHash });
  }

  saveWalletsFile({
    chainId: deployment.chainId ?? 84532,
    network: "baseSepolia",
    fundedAt: new Date().toISOString(),
    funder: funder.address,
    usdcPerWallet: USDC_PER_WALLET,
    ethPerWalletWei: ETH_PER_WALLET.toString(),
    wallets,
  });

  console.log(`Done — saved ${count} wallets to ${WALLETS_PATH}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

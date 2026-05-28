/* eslint-disable no-console */
/**
 * Random router trades from wallets.json on the last BTC market (or MARKET_ADDRESS env).
 *
 * Env: TRADE_COUNT (default 10), TRADE_MIN_USDC (20), TRADE_MAX_USDC (47)
 */
const {
  ERC20_ABI,
  ROUTER_ABI,
  estimateMinSharesOut,
  ensureErc20Allowance,
  loadLastMarket,
  loadWalletsFile,
  makeClients,
  randomInt,
  randomUsdcAmount,
  readDeployment,
} = require("./lib/aftr-scripts-lib.cjs");
const { parseUnits } = require("viem");

const MARKET_ABI = [
  {
    type: "function",
    name: "priceOf",
    stateMutability: "view",
    inputs: [{ name: "outcomeIndex", type: "uint8" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "stakeEndTimestamp",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "resolveAfterTimestamp",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

async function tradeOnce({ marketAddress, routerAddress, usdcAddress, wallet, publicClient, minUsdc, maxUsdc }) {
  const { account, walletClient } = makeClients(wallet.privateKey);
  const outcomeIndex = randomInt(0, 1);
  const amountHuman = randomUsdcAmount(minUsdc, maxUsdc);
  const amountUnits = parseUnits(amountHuman, 6);

  const [price, allowance] = await Promise.all([
    publicClient.readContract({
      address: marketAddress,
      abi: MARKET_ABI,
      functionName: "priceOf",
      args: [outcomeIndex],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, routerAddress],
    }),
  ]);

  if (allowance < amountUnits) {
    await ensureErc20Allowance(
      publicClient,
      walletClient,
      usdcAddress,
      account.address,
      routerAddress,
      amountUnits,
    );
  }

  const minSharesOut = estimateMinSharesOut(amountUnits, price, 800);

  const hash = await walletClient.writeContract({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: "depositForSelf",
    args: [marketAddress, outcomeIndex, amountUnits, minSharesOut],
    account,
    gas: 500000n,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return {
    trader: account.address,
    outcomeIndex,
    amountHuman,
    tx: hash,
  };
}

async function main() {
  const deployment = readDeployment();
  const routerAddress = deployment.contracts.AFTRMarketDebtRouter;
  const usdcAddress = deployment.contracts.AFTRUSDC;
  const last = loadLastMarket();
  const marketAddress = process.env.MARKET_ADDRESS || last.marketAddress;
  if (!marketAddress) throw new Error("No market address");

  const walletsFile = loadWalletsFile();
  const wallets = walletsFile.wallets || [];
  if (wallets.length === 0) throw new Error("No wallets in wallets.json");

  const tradeCount = Number(process.env.TRADE_COUNT || 10);
  const minUsdc = Number(process.env.TRADE_MIN_USDC || 20);
  const maxUsdc = Number(process.env.TRADE_MAX_USDC || 47);

  const { publicClient } = makeClients(wallets[0].privateKey);
  const now = Math.floor(Date.now() / 1000);
  const [state, stakeEnd, resolveAfter] = await Promise.all([
    publicClient.readContract({
      address: marketAddress,
      abi: MARKET_ABI,
      functionName: "state",
    }),
    publicClient.readContract({
      address: marketAddress,
      abi: MARKET_ABI,
      functionName: "stakeEndTimestamp",
    }),
    publicClient.readContract({
      address: marketAddress,
      abi: MARKET_ABI,
      functionName: "resolveAfterTimestamp",
    }),
  ]);

  console.log(`Market: ${marketAddress}`);
  console.log(`Router: ${routerAddress}`);
  console.log(`State: ${state} | stakeEnd: ${stakeEnd} | resolveAfter: ${resolveAfter} | now: ${now}`);

  if (Number(state) !== 0) throw new Error(`Market not OPEN (state ${state})`);
  if (now >= Number(resolveAfter) || now >= Number(stakeEnd)) {
    throw new Error("Trading window closed for this market");
  }

  const results = [];
  for (let i = 0; i < tradeCount; i += 1) {
    const wallet = wallets[randomInt(0, wallets.length - 1)];
    console.log(`[${i + 1}/${tradeCount}] Trading from ${wallet.address}...`);
    try {
      const r = await tradeOnce({
        marketAddress,
        routerAddress,
        usdcAddress,
        wallet,
        publicClient,
        minUsdc,
        maxUsdc,
      });
      console.log(
        `  OK outcome=${r.outcomeIndex} amount=${r.amountHuman} USDC tx=${r.tx}`,
      );
      results.push(r);
    } catch (err) {
      console.error(`  FAIL: ${err.message || err}`);
    }
  }

  console.log(`Finished ${results.length}/${tradeCount} successful trades.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

/* eslint-disable no-console */
/**
 * Create a BTC price market: 5% above spot, 1h stake, resolve 5m after stake end.
 * Uploads cover image + metadata to Lighthouse (requires LIGHTHOUSE_API_KEY).
 *
 * Env: PRIVATE_KEY, LIGHTHOUSE_API_KEY, optional SEED_AMOUNT (default 20 USDC)
 */
const fs = require("fs");
const path = require("path");

const {
  ERC20_ABI,
  FACTORY_ABI,
  MARKET_ABI,
  buildPriceTitle,
  ensureErc20Allowance,
  fetchBtcSpot,
  getFunderClients,
  keccak256,
  parseMarketCreatedAddress,
  parseUnits,
  readDeployment,
  LAST_MARKET_PATH,
  saveLastMarket,
  toBytes,
  uploadToLighthouse,
  parseAbi,
} = require("./lib/aftr-scripts-lib.cjs");

const STAKE_DURATION_SEC = 60 * 60;
const RESOLVE_AFTER_STAKE_SEC = 5 * 60;
const THRESHOLD_MULTIPLIER = 1.05;
const DEFAULT_SEED = "20";

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

async function main() {
  const deployment = readDeployment();
  const factoryAddress = deployment.contracts.AFTRParimutuelMarketFactory;
  const usdcAddress = deployment.contracts.AFTRUSDC;
  const routerAddress = deployment.contracts.AFTRMarketDebtRouter;
  const btcFeed = deployment.external?.chainlinkFeeds?.find((f) => f.asset === "BTC");
  if (!factoryAddress || !usdcAddress || !btcFeed?.address) {
    throw new Error("Deployment missing factory, AFTRUSDC, or BTC feed");
  }

  const seedHuman = process.env.SEED_AMOUNT || DEFAULT_SEED;
  const { account, publicClient, walletClient } = getFunderClients();

  const nowSec = Math.floor(Date.now() / 1000);
  const minFuture = nowSec + 5 * 60 + 30;
  const stakeEndTimestamp = BigInt(nowSec + STAKE_DURATION_SEC);
  const resolveAfterTimestamp = stakeEndTimestamp + BigInt(RESOLVE_AFTER_STAKE_SEC);

  if (Number(stakeEndTimestamp) < minFuture || Number(resolveAfterTimestamp) < minFuture) {
    throw new Error("Timestamps too soon — wait and retry");
  }

  const { spot } = await fetchBtcSpot(publicClient, btcFeed.address);
  const thresholdValue = spot * THRESHOLD_MULTIPLIER;
  const thresholdDisplay = thresholdValue.toLocaleString(undefined, { maximumFractionDigits: 8 });
  const cleanedThreshold = thresholdDisplay.replaceAll(",", "").trim();
  const priceThreshold = parseUnits(cleanedThreshold, 8);

  const resolveMs = Number(resolveAfterTimestamp) * 1000;
  const generatedPrompt = buildPriceTitle({
    asset: "BTC",
    comparison: "ABOVE",
    thresholdDisplay,
    resolveMs,
  });

  console.log(`Spot BTC/USD: $${spot.toLocaleString(undefined, { maximumFractionDigits: 8 })}`);
  console.log(`Threshold (+5%): $${thresholdDisplay}`);
  console.log(`Title: ${generatedPrompt}`);
  console.log(`Stake end (unix): ${stakeEndTimestamp}`);
  console.log(`Resolve after (unix): ${resolveAfterTimestamp}`);

  const imagePath =
    process.env.MARKET_IMAGE_PATH || path.join(__dirname, "..", "public", "fishy.webp");
  if (!fs.existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`);
  const imageBuf = fs.readFileSync(imagePath);
  console.log("Uploading cover image to Lighthouse...");
  const imageUri = await uploadToLighthouse(imageBuf, path.basename(imagePath), "image/webp");

  const metadata = {
    title: generatedPrompt,
    description: "Automated BTC price market (Base Sepolia).",
    marketKind: "price",
    eventMode: null,
    question: generatedPrompt,
    categories: ["crypto"],
    slug: slugify(generatedPrompt),
    outcomes: ["Yes", "No"],
    image: imageUri,
    priceConfig: {
      feed: btcFeed.label,
      feedAddress: btcFeed.address,
      currentPrice: spot.toLocaleString(undefined, { maximumFractionDigits: 8 }),
      comparison: "ABOVE",
      threshold: thresholdDisplay,
      generatedPrompt,
    },
    umaAncillary: null,
  };

  console.log("Uploading metadata to Lighthouse...");
  const metadataUri = await uploadToLighthouse(
    Buffer.from(JSON.stringify(metadata, null, 2), "utf8"),
    "market-metadata.json",
    "application/json",
  );

  const metadataHash = keccak256(toBytes(metadataUri));
  const decimals = 6;
  const seedUnits = parseUnits(seedHuman, decimals);
  const minBootstrapTotal = parseUnits("10", decimals);

  if (seedUnits % 2n !== 0n) {
    throw new Error("Seed must be divisible by 2 outcomes");
  }
  if (seedUnits < minBootstrapTotal) {
    throw new Error(`Seed must be at least 10 USDC`);
  }

  await ensureErc20Allowance(
    publicClient,
    walletClient,
    usdcAddress,
    account.address,
    factoryAddress,
    seedUnits,
  );

  console.log("Creating price market on factory...");
  const createHash = await walletClient.writeContract({
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: "createPriceMarket",
    args: [
      {
        collateralToken: usdcAddress,
        collateralDecimals: decimals,
        virtualReserve: seedUnits,
        stakeEndTimestamp,
        resolveAfterTimestamp,
        metadataHash,
        outcomeLabels: ["Yes", "No"],
        metadataURI: metadataUri,
        chainlinkFeed: btcFeed.address,
        priceThreshold,
        priceKind: 0,
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
        minBootstrapTotal,
        bootstrapAmount: seedUnits,
        shareRecipient: account.address,
      },
    ],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  if (receipt.status !== "success") {
    throw new Error(`createPriceMarket reverted (tx ${createHash})`);
  }
  let marketAddress = parseMarketCreatedAddress(receipt, factoryAddress);
  if (!marketAddress) {
    const len = await publicClient.readContract({
      address: factoryAddress,
      abi: parseAbi(["function markets(uint256) view returns (address)", "function marketsLength() view returns (uint256)"]),
      functionName: "marketsLength",
    });
    if (len > 0n) {
      marketAddress = await publicClient.readContract({
        address: factoryAddress,
        abi: parseAbi(["function markets(uint256) view returns (address)"]),
        functionName: "markets",
        args: [len - 1n],
      });
    }
  }
  if (!marketAddress) throw new Error("Could not resolve market address from receipt");

  const bootstrapped = await publicClient.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "bootstrapped",
  });

  const record = {
    chainId: deployment.chainId ?? 84532,
    createdAt: new Date().toISOString(),
    creator: account.address,
    marketAddress,
    factoryAddress,
    routerAddress,
    collateral: usdcAddress,
    btcFeed: btcFeed.address,
    spot,
    thresholdDisplay,
    priceThreshold: priceThreshold.toString(),
    stakeEndTimestamp: stakeEndTimestamp.toString(),
    resolveAfterTimestamp: resolveAfterTimestamp.toString(),
    title: generatedPrompt,
    metadataUri,
    imageUri,
    seedAmount: seedHuman,
    bootstrapped,
    createTx: createHash,
  };

  saveLastMarket(record);
  console.log(`Market: ${marketAddress}`);
  console.log(`Bootstrapped: ${bootstrapped}`);
  console.log(`Saved ${path.basename(LAST_MARKET_PATH)}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

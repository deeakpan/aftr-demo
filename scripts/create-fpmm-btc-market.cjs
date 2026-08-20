/* eslint-disable no-console */
/**
 * Create a BTC FPMM price market with Lighthouse metadata (mirrors create-btc-price-market.cjs).
 *
 * Usage: npx hardhat run scripts/create-fpmm-btc-market.cjs --network hardhat
 * Env: LIGHTHOUSE_API_KEY (optional — uses ipfs:// stub if missing), SEED_AMOUNT (default 200 USDG units)
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { deployFpmmStack } = require("./lib/deploy-fpmm-stack.cjs");
const {
  keccak256,
  toBytes,
  uploadToLighthouse,
} = require("./lib/aftr-scripts-lib.cjs");

const STAKE_DURATION_SEC = 60 * 60;
const RESOLVE_AFTER_STAKE_SEC = 5 * 60;
const THRESHOLD_MULTIPLIER = 1.05;

async function deployAndTrack(factory, ...args) {
  const instance = await factory.deploy(...args);
  const receipt = await instance.deploymentTransaction().wait();
  return { instance, address: await instance.getAddress(), blockNumber: receipt.blockNumber };
}

function btcAssetKey() {
  return hre.ethers.keccak256(hre.ethers.toUtf8Bytes("BTC"));
}

async function main() {
  const [creator, admin1, admin2, admin3, feeRecipient] = await hre.ethers.getSigners();
  const deploymentBlocks = {};

  const MockFeed = await hre.ethers.getContractFactory("MockChainlinkFeed");
  const feed = await MockFeed.deploy(100_000n * 10n ** 8n, 8, creator.address);

  const USDG = await hre.ethers.getContractFactory("USDG");
  const usdg = await USDG.deploy(creator.address);
  await usdg.mint(creator.address, hre.ethers.parseUnits("100000", 6));

  const { fpmmFactory: factoryAddr } = await deployFpmmStack(hre, creator, feeRecipient.address, {
    deployAndTrack,
    deploymentBlocks,
    chainlinkFeeds: [{ asset: "BTC", address: await feed.getAddress() }],
    collateralTokens: [await usdg.getAddress()],
    resolutionAdmins: [admin1.address, admin2.address, admin3.address],
    ponsResolutionAdmin: creator.address,
  });

  const factory = await hre.ethers.getContractAt("ZedkrFpmmMarketFactory", factoryAddr);
  await factory.setPriceFeed(btcAssetKey(), await feed.getAddress());

  const seedHuman = process.env.SEED_AMOUNT || "200";
  const seedUnits = hre.ethers.parseUnits(seedHuman, 6);
  const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
  const stakeEnd = now + STAKE_DURATION_SEC;
  const resolveAfter = stakeEnd + RESOLVE_AFTER_STAKE_SEC;

  const thresholdDisplay = "105000";
  const title = `Will BTC be above $${thresholdDisplay} by resolve time?`;

  let metadataURI = `ipfs://zedkr-fpmm-btc-${Date.now()}`;
  const coverPath = path.join(__dirname, "..", "public", "pons.png");
  if (process.env.LIGHTHOUSE_API_KEY?.trim() && fs.existsSync(coverPath)) {
    try {
      const uploaded = await uploadToLighthouse({
        apiKey: process.env.LIGHTHOUSE_API_KEY.trim(),
        coverPath,
        metadata: {
          title,
          description: `Zedkr FPMM BTC market — ${thresholdDisplay} threshold`,
          marketType: "price",
          slug: `btc-fpmm-${Date.now()}`,
          outcomeLabels: [`Above $${thresholdDisplay}`, `Below $${thresholdDisplay}`],
        },
      });
      metadataURI = uploaded.metadataUri || metadataURI;
      console.log("Uploaded metadata:", metadataURI);
    } catch (e) {
      console.warn("Lighthouse upload skipped:", e.message ?? e);
    }
  }

  const metadataHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(metadataURI));
  await usdg.connect(creator).approve(factoryAddr, seedUnits);

  const params = {
    base: {
      collateralToken: await usdg.getAddress(),
      collateralDecimals: 6,
      stakeEndTimestamp: stakeEnd,
      resolveAfterTimestamp: resolveAfter,
      metadataHash,
      outcomeLabels: [`Above $${thresholdDisplay}`, `Below $${thresholdDisplay}`],
      metadataURI,
      minInitialFunding: hre.ethers.parseUnits("100", 6),
      initialFunding: seedUnits,
      fundingHint: [1n, 1n],
      shareRecipient: creator.address,
    },
    priceAssetKey: btcAssetKey(),
    priceThreshold: hre.ethers.parseUnits(thresholdDisplay.replaceAll(",", ""), 6),
    priceKind: 0,
    priceUpperBound: 0n,
    maxPriceStaleness: 3600n,
    priceBinLower: [],
    priceBinUpper: [],
  };

  const tx = await factory.connect(creator).createPriceMarket(params);
  const receipt = await tx.wait();
  const iface = factory.interface;
  let marketAddr;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "MarketCreated") {
        marketAddr = parsed.args.market;
        break;
      }
    } catch {
      // skip
    }
  }

  console.log("\nFPMM market created:", marketAddr);
  console.log("  metadataURI:", metadataURI);
  console.log("  collateral: USDG");
  console.log("  seed:", seedHuman);

  const market = await hre.ethers.getContractAt("ZedkrFpmmMarket", marketAddr);
  console.log("  funded:", await market.funded());
  console.log("  price[0]:", (await market.priceOf(0)).toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

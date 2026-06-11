/* eslint-disable no-console */
/**
 * Deploy full Mondalore stack (markets + staking — no USDeAD / DRP / debt router):
 *   MondaloreUSDC, MondaloreToken, MondaloreFeeVault (feeRecipient),
 *   MondaloreParimutuelMarketFactory + deployers, MondaloreOrderBook.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-aftr-full-stack.cjs --network monadTestnet
 *
 * Env (optional):
 *   VAULT_EPOCH_DURATION     — epoch length in seconds (default: 604800 = 7 days)
 *   VAULT_LOCK_DURATION      — min lock per stake lot in seconds (default: 604800 = 7 days)
 *   Mondalore_INITIAL_MINT   — initial MONDO mint to deployer (default: 100_000_000e18)
 *   RESOLUTION_ADMINS        — comma-separated admin addresses (default: first 4 from wallets.json)
 *   MONAD_WETH               — existing WETH on Monad (if set, skips MockWETH deploy)
 *   MONAD_WRAP_MON           — MON to wrap into MockWETH for deployer (default: 1)
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const hre = require("hardhat");
const { deployParimutuelFacade } = require("./lib/deploy-parimutuel-facade.cjs");
const { WALLETS_PATH } = require("./lib/aftr-scripts-lib.cjs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

/** Circle test USDC on Base Sepolia (UMA-whitelisted). */
const BASE_SEPOLIA_CIRCLE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const UMA_REWARD_USDC = 500_000n;

const OOv2_BASE_SEPOLIA = "0x99EC530a761E68a377593888D9504002Bd191717";
const BASE_SEPOLIA_WETH = "0x4200000000000000000000000000000000000006";
const BASE_SEPOLIA_ETH_FEED = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1";

/** Chainlink Price Feed proxy addresses on Monad testnet — https://docs.chain.link/data-feeds/price-feeds/addresses?network=monad&networkType=testnet */
const MONAD_TESTNET_CHAINLINK = {
  ETH_USD: "0x0c76859E85727683Eeba0C70Bc2e0F5781337818",
  BTC_USD: "0x2Cd9D7E85494F68F5aF08EF96d6FD5e8F71B4d31",
  LINK_USD: "0x4682035965Cd2B88759193ee2660d8A0766e1391",
  USDC_USD: "0x70BB0758a38ae43418ffcEd9A25273dd4e804D15",
  USDT_USD: "0x14eE6bE30A91989851Dc23203E41C804D4D71441",
};

function monadChainlinkFeedsForDeployment() {
  return [
    {
      label: "ETH/USD",
      asset: "ETH",
      logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
      address: MONAD_TESTNET_CHAINLINK.ETH_USD,
    },
    {
      label: "BTC/USD",
      asset: "BTC",
      logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
      address: MONAD_TESTNET_CHAINLINK.BTC_USD,
    },
    {
      label: "LINK/USD",
      asset: "LINK",
      logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
      address: MONAD_TESTNET_CHAINLINK.LINK_USD,
    },
    {
      label: "USDC/USD",
      asset: "USDC",
      logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
      address: MONAD_TESTNET_CHAINLINK.USDC_USD,
    },
    {
      label: "USDT/USD",
      asset: "USDT",
      logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png",
      address: MONAD_TESTNET_CHAINLINK.USDT_USD,
    },
  ];
}

function networkExternals(chainId) {
  if (chainId === 84532) {
    return {
      oo: OOv2_BASE_SEPOLIA,
      circleUsdc: BASE_SEPOLIA_CIRCLE_USDC,
      weth: BASE_SEPOLIA_WETH,
      ethFeed: BASE_SEPOLIA_ETH_FEED,
      registerCircleUsdc: true,
    };
  }
  if (chainId === 10143) {
    const oo = process.env.UMA_OOV2?.trim() || "0x0000000000000000000000000000000000000001";
    const circleUsdc = process.env.UMA_BOND_CURRENCY?.trim();
    if (!process.env.UMA_OOV2?.trim()) {
      console.warn(
        "Monad: UMA_OOV2 not set — price markets deploy fine; set a real OO before creating event (UMA) markets.",
      );
    }
    return {
      oo,
      circleUsdc: circleUsdc || null,
      deployLocalWeth: !process.env.MONAD_WETH?.trim() && !process.env.DRP_WETH?.trim(),
      registerCircleUsdc: Boolean(circleUsdc),
      ethFeed: MONAD_TESTNET_CHAINLINK.ETH_USD,
      chainlinkFeeds: monadChainlinkFeedsForDeployment(),
    };
  }
  throw new Error(`Unsupported chainId ${chainId}. Add networkExternals() mapping or use baseSepolia / monadTestnet.`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deploy a contract and return { instance, address, blockNumber }.
 * blockNumber is the block the deployment tx was mined in.
 */
async function deployAndTrack(factory, ...args) {
  const instance = await factory.deploy(...args);
  const receipt = await instance.deploymentTransaction().wait();
  const address = await instance.getAddress();
  const blockNumber = receipt.blockNumber;
  return { instance, address, blockNumber };
}

function writeDeploymentJson(hre_, data) {
  const root = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(root, { recursive: true });
  const networkName = hre_.network.name;
  const chainId = Number(data.chainId);
  const fileName = `${networkName}-${chainId}.json`;
  const outPath = path.join(root, fileName);

  // Preserve fields from previous deployment that we don't overwrite
  // (e.g. chainlinkFeeds, vaultCollateralOptions).
  let prev = {};
  if (fs.existsSync(outPath)) {
    try { prev = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch {}
  }

  const payload = {
    ...prev,
    ...data,
    network: networkName,
    chainId,
    deployedAt: new Date().toISOString(),
    // Merge external rather than overwrite so chainlinkFeeds survive re-deploys.
    external: { ...(prev.external ?? {}), ...(data.external ?? {}) },
  };

  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("Wrote deployment record:", outPath);
  return outPath;
}

function tryReadDeployment(networkName, chainId) {
  const outPath = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(outPath)) return null;
  try { return JSON.parse(fs.readFileSync(outPath, "utf8")); } catch { return null; }
}

/** First 4 addresses from wallets.json, or RESOLUTION_ADMINS env, or deployer. */
function loadResolutionAdmins(deployerAddress) {
  if (process.env.RESOLUTION_ADMINS?.trim()) {
    return process.env.RESOLUTION_ADMINS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (fs.existsSync(WALLETS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
      const addrs = (data.wallets ?? []).slice(0, 4).map((w) => w.address).filter(Boolean);
      if (addrs.length >= 3) {
        console.log("  RESOLUTION_ADMINS from wallets.json (first 4):", addrs.join(", "));
        return addrs;
      }
    } catch (e) {
      console.warn("  Could not read wallets.json for RESOLUTION_ADMINS:", e.message ?? e);
    }
  }
  return [deployerAddress];
}

/** Deploy MockWETH on Monad testnet; use official Chainlink feeds (no mocks). */
async function deployMonadTestExternals(hre_, deployer, deployAndTrack, deploymentBlocks) {
  console.log("\n[0a] Deploying MockWETH...");
  const WethF = await hre_.ethers.getContractFactory("MockWETH");
  const { instance: weth, address: wethAddress, blockNumber: wethBlock } = await deployAndTrack(WethF);
  deploymentBlocks.MockWETH = wethBlock;
  console.log(`  MockWETH: ${wethAddress} (block ${wethBlock})`);

  const ethFeed = MONAD_TESTNET_CHAINLINK.ETH_USD;
  const btcFeed = MONAD_TESTNET_CHAINLINK.BTC_USD;
  console.log("[0b] Using Chainlink Price Feeds on Monad testnet (no mock feeds):");
  console.log(`  ETH/USD: ${ethFeed}`);
  console.log(`  BTC/USD: ${btcFeed}`);
  console.log(`  (+ LINK, USDC, USDT — see deployment JSON chainlinkFeeds)`);

  const wrapMon = process.env.MONAD_WRAP_MON?.trim();
  const wrapAmount = wrapMon ? hre_.ethers.parseEther(wrapMon) : hre_.ethers.parseEther("1");
  try {
    const bal = await hre_.ethers.provider.getBalance(deployer.address);
    if (bal > wrapAmount + hre_.ethers.parseEther("0.05")) {
      const tx = await weth.deposit({ value: wrapAmount });
      await tx.wait();
      console.log(`  Wrapped ${hre_.ethers.formatEther(wrapAmount)} MON → WETH for deployer`);
    }
  } catch (e) {
    console.warn("  Skipped WETH wrap:", e.shortMessage ?? e.message);
  }

  return {
    weth: wethAddress,
    wethFeed: ethFeed,
    btcFeed,
    chainlinkFeeds: monadChainlinkFeedsForDeployment(),
    vaultCollateralOptions: [{ label: "WETH", address: wethAddress }],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const netExt = networkExternals(chainId);
  const prev = tryReadDeployment(hre.network.name, chainId);

  // Track all deployment blocks for subgraph startBlock configuration.
  const deploymentBlocks = { ...(prev?.deploymentBlocks ?? {}) };

  let monadExternals = null;
  if (chainId === 10143 && netExt.deployLocalWeth) {
    monadExternals = await deployMonadTestExternals(hre, deployer, deployAndTrack, deploymentBlocks);
  } else if (chainId === 10143) {
    monadExternals = {
      wethFeed: netExt.ethFeed,
      chainlinkFeeds: netExt.chainlinkFeeds,
    };
  }

  const weth =
    process.env.MONAD_WETH?.trim() ||
    process.env.DRP_WETH?.trim() ||
    monadExternals?.weth ||
    netExt.weth ||
    BASE_SEPOLIA_WETH;

  const epochDuration = BigInt(process.env.VAULT_EPOCH_DURATION?.trim() || "604800");  // 7 days
  const lockDuration  = BigInt(process.env.VAULT_LOCK_DURATION?.trim()  || "604800");  // 7 days
  const aftrInitialMint = BigInt(process.env.Mondalore_INITIAL_MINT?.trim()  || String(100_000_000n * 10n ** 18n));

  // ── 1. MondaloreUSDC test token ─────────────────────────────────────────────
  console.log("\n[1/7] Deploying MondaloreUSDC (test collateral)...");
  const MondaloreUF = await hre.ethers.getContractFactory("MondaloreUSDC");
  const { instance: aftrUsdc, address: aftrUsdcAddr, blockNumber: aftrUsdcBlock } =
    await deployAndTrack(MondaloreUF, deployer.address);
  deploymentBlocks.MondaloreUSDC = aftrUsdcBlock;
  console.log(`  MondaloreUSDC: ${aftrUsdcAddr} (block ${aftrUsdcBlock})`);

  const extraUsdcMint = process.env.MondaloreUSDC_EXTRA_MINT?.trim() || "1000000";
  try {
    const extra = BigInt(extraUsdcMint) * 10n ** 6n;
    await (await aftrUsdc.mint(deployer.address, extra)).wait();
    console.log(`  Minted ${extraUsdcMint} extra MondaloreUSDC to deployer`);
  } catch (e) {
    console.warn("  Extra MondaloreUSDC mint skipped:", e.shortMessage ?? e.message);
  }

  // ── 2. Mondalore governance token ───────────────────────────────────────────
  console.log("\n[2/7] Deploying MONDO token (MondaloreToken)...");
  const MondaloreTokenF = await hre.ethers.getContractFactory("MondaloreToken");
  const { address: aftrTokenAddr, blockNumber: aftrTokenBlock } =
    await deployAndTrack(MondaloreTokenF, deployer.address, aftrInitialMint);
  deploymentBlocks.MondaloreToken = aftrTokenBlock;
  console.log(`  MONDO: ${aftrTokenAddr} (block ${aftrTokenBlock})`);
  console.log(`  Initial mint: ${(aftrInitialMint / 10n ** 18n).toLocaleString()} MONDO to deployer`);

  // ── 3. MondaloreFeeVault ────────────────────────────────────────────────────
  console.log("\n[3/7] Deploying MondaloreFeeVault...");
  const VaultF = await hre.ethers.getContractFactory("MondaloreFeeVault");
  const { instance: vault, address: vaultAddr, blockNumber: vaultBlock } =
    await deployAndTrack(VaultF, deployer.address, aftrTokenAddr, epochDuration, lockDuration);
  deploymentBlocks.MondaloreFeeVault = vaultBlock;
  console.log(`  MondaloreFeeVault: ${vaultAddr} (block ${vaultBlock})`);
  console.log(`  Epoch: ${epochDuration}s  Lock: ${lockDuration}s`);

  // ── 4. Factory ─────────────────────────────────────────────────────────────
  // feeRecipient = vault so protocol fees flow into the staking accumulator.
  console.log("\n[4/7] Deploying MondaloreParimutuelMarketFactory...");
  const FactoryF = await hre.ethers.getContractFactory("MondaloreParimutuelMarketFactory");
  const { instance: factory, address: factoryAddress, blockNumber: factoryBlock } =
    await deployAndTrack(
      FactoryF,
      deployer.address,
      vaultAddr,
      hre.ethers.ZeroAddress,
      hre.ethers.ZeroAddress,
    );
  deploymentBlocks.MondaloreParimutuelMarketFactory = factoryBlock;
  console.log(`  Factory: ${factoryAddress} (block ${factoryBlock})`);
  console.log(`  feeRecipient = vault (${vaultAddr})`);

  const resolutionAdmins = loadResolutionAdmins(deployer.address);
  if (resolutionAdmins.length < 3) {
    console.warn(
      "  WARNING: fewer than 3 RESOLUTION_ADMINS — event markets cannot be created until setResolutionAdmins is called.",
    );
    if (resolutionAdmins.length > 0) {
      await (await factory.setResolutionAdmins(resolutionAdmins)).wait();
      console.log("  Resolution admins (incomplete):", resolutionAdmins.join(", "));
    }
  } else {
    await (await factory.setResolutionAdmins(resolutionAdmins)).wait();
    console.log("  Resolution admins (3-of-10):", resolutionAdmins.join(", "));
  }

  // ── 5. Deployer lib (3 txs — avoids EIP-3860 initcode limit) ───────────────
  console.log("\n[5/7] Deploying MondaloreParimutuelDeployer + sub-deployers...");
  const {
    marketDeployerAddress,
    facadeBlock,
    priceDep,
    eventDep,
    priceBlock,
    eventBlock,
  } = await deployParimutuelFacade(hre, deployer, factoryAddress, deployAndTrack);
  deploymentBlocks.MondaloreParimutuelDeployer = facadeBlock;
  deploymentBlocks.MondalorePriceMarketDeployer = priceBlock;
  deploymentBlocks.MondaloreEventMarketDeployer = eventBlock;
  console.log(`  MondalorePriceMarketDeployer:  ${priceDep} (block ${priceBlock})`);
  console.log(`  MondaloreEventMarketDeployer:  ${eventDep} (block ${eventBlock})`);
  console.log(`  MondaloreParimutuelDeployer:   ${marketDeployerAddress} (block ${facadeBlock})`);

  await (await factory.setMarketDeployer(marketDeployerAddress)).wait();
  console.log("  Linked factory.marketDeployer");

  const registerWeth = chainId === 10143 && weth.toLowerCase() !== BASE_SEPOLIA_WETH.toLowerCase();
  const collateralLabels = ["MondaloreUSDC"];
  if (netExt.registerCircleUsdc && netExt.circleUsdc) collateralLabels.push("Circle USDC");
  if (registerWeth) collateralLabels.push("WETH");

  console.log(`  Registering collaterals: ${collateralLabels.join(", ")}`);
  await (await factory.addSupportedCollateral(aftrUsdcAddr)).wait();
  if (netExt.registerCircleUsdc && netExt.circleUsdc) {
    await (await factory.addSupportedCollateral(netExt.circleUsdc)).wait();
  }
  if (registerWeth) {
    await (await factory.addSupportedCollateral(weth)).wait();
    await (await factory.setWrappedNativeToken(weth)).wait();
    await (await factory.addSupportedCollateral(hre.ethers.ZeroAddress)).wait();
  }

  console.log("  Registering vault reward tokens...");
  await (await vault.addRewardToken(aftrUsdcAddr)).wait();
  if (netExt.registerCircleUsdc && netExt.circleUsdc) {
    await (await vault.addRewardToken(netExt.circleUsdc)).wait();
  }
  if (registerWeth) {
    await (await vault.addRewardToken(weth)).wait();
  }
  await (await vault.addRewardToken("0x0000000000000000000000000000000000000000")).wait();
  console.log(`  Vault reward tokens: ${collateralLabels.join(", ")}, native MON`);

  // ── 6. OrderBook ───────────────────────────────────────────────────────────
  console.log("\n[6/7] Deploying MondaloreOrderBook...");
  const OrderBookF = await hre.ethers.getContractFactory("MondaloreOrderBook");
  const { address: orderBookAddress, blockNumber: orderBookBlock } =
    await deployAndTrack(OrderBookF, factoryAddress, deployer.address, deployer.address);
  deploymentBlocks.MondaloreOrderBook = orderBookBlock;
  console.log(`  OrderBook: ${orderBookAddress} (block ${orderBookBlock})`);

  // ── Write deployment JSON ──────────────────────────────────────────────────
  writeDeploymentJson(hre, {
    chainId,
    deployer: deployer.address,
    feeRecipient: vaultAddr,
    contracts: {
      MondaloreToken:                    aftrTokenAddr,
      MondaloreFeeVault:                 vaultAddr,
      MondaloreUSDC:                     aftrUsdcAddr,
      MondaloreParimutuelMarketFactory:  factoryAddress,
      MondalorePriceMarketDeployer:      priceDep,
      MondaloreEventMarketDeployer:      eventDep,
      MondaloreParimutuelDeployer:       marketDeployerAddress,
      MondaloreOrderBook:                orderBookAddress,
      ...(registerWeth ? { MockWETH: weth } : {}),
    },
    // Block numbers for every contract — used as subgraph startBlock values.
    deploymentBlocks,
    external: {
      optimisticOracleV2:           netExt.oo,
      umaBondCurrencyCircleUSDC:    netExt.circleUsdc || aftrUsdcAddr,
      ...(monadExternals?.chainlinkFeeds ? { chainlinkFeeds: monadExternals.chainlinkFeeds } : {}),
      ...(monadExternals?.vaultCollateralOptions
        ? { vaultCollateralOptions: monadExternals.vaultCollateralOptions }
        : {}),
    },
    vault: {
      stakeToken:    aftrTokenAddr,
      epochDuration: epochDuration.toString(),
      lockDuration:  lockDuration.toString(),
      rewardTokens: [
        aftrUsdcAddr,
        ...(netExt.registerCircleUsdc && netExt.circleUsdc ? [netExt.circleUsdc] : []),
        ...(registerWeth ? [weth] : []),
        "0x0000000000000000000000000000000000000000",
      ],
    },
    resolutionAdmins,
    suggestedUmaReward: UMA_REWARD_USDC.toString(),
    notes: {
      tradingCollaterals: collateralLabels,
      umaRewardToken: netExt.circleUsdc
        ? "Circle USDC when umaRewardCurrency is address(0) on factory"
        : "MondaloreUSDC when umaRewardCurrency is address(0) on factory",
      feeFlow: "Market deposit → 1.2% → MondaloreFeeVault.receiveFees() → 0.2% stakers / 1.0% treasury",
    },
  });

  // ── Subgraph: patch subgraph.yaml from deployment JSON ─────────────────────
  try {
    const root = path.join(__dirname, "..");
    execSync("node scripts/subgraph-update-config.cjs", { cwd: root, stdio: "inherit" });
    console.log("  Patched subgraph/subgraph.yaml (Factory, Vault).");
  } catch (e) {
    console.warn("  subgraph-update-config failed — run: npm run subgraph:update-config", e?.message ?? e);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Deployment complete. Key addresses:");
  console.log(`  MondaloreToken:                   ${aftrTokenAddr}`);
  console.log(`  MondaloreFeeVault:                ${vaultAddr}  ← feeRecipient`);
  console.log(`  MondaloreParimutuelMarketFactory: ${factoryAddress}`);
  console.log(`  MondaloreOrderBook:               ${orderBookAddress}`);
  console.log("\nNext steps:");
  console.log("  1. subgraph/subgraph.yaml was updated — run: npm run subgraph:codegen && npm run subgraph:build");
  console.log("  2. Deploy to Studio: SUBGRAPH_VERSION_LABEL=v0.07 npm run subgraph:deploy-studio");
  console.log("  3. Distribute Mondalore tokens to stakers / liquidity programs.");
  console.log("  4. Create markets from the UI — each market auto-seeds on creation.");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

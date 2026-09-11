/* eslint-disable no-console */
/**
 * Deploy full Zedkr stack (markets + staking — no USDeAD / DRP / debt router):
 *   ZedkrUSDC, ZedkrToken, ZedkrFeeVault (feeRecipient),
 *   Zedkr FPMM factory + ZedkrOrderBook (via FPMM adapter).
 *
 * Usage:
 *   npx hardhat run scripts/deploy-aftr-full-stack.cjs --network unichainSepolia
 *   npx hardhat run scripts/deploy-aftr-full-stack.cjs --network monadTestnet
 *
 * Env (optional):
 *   VAULT_EPOCH_DURATION     — epoch length in seconds (default: 604800 = 7 days)
 *   VAULT_LOCK_DURATION      — min lock per stake lot in seconds (default: 604800 = 7 days)
 *   Zedkr_INITIAL_MINT   — initial MONDO mint to deployer (default: 100_000_000e18)
 *   RESOLUTION_ADMINS        — comma-separated admin addresses (default: first 4 from wallets.json)
 *   MONAD_WETH               — existing WETH on Monad (if set, skips MockWETH deploy)
 *   MONAD_WRAP_MON           — MON to wrap into MockWETH for deployer (default: 1)
 *   USE_REAL_USDG=1          — use canonical Robinhood USDG instead of deploying mintable mock
 *   USDG_ADDRESS / ROBINHOOD_USDG — force a specific USDG (implies real/existing, skips mock deploy)
 *   USDG_EXTRA_MINT          — extra mock USDG minted to deployer (default: 1000000)
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const hre = require("hardhat");
const { deployFpmmStack } = require("./lib/deploy-fpmm-stack.cjs");
const { WALLETS_PATH } = require("./lib/aftr-scripts-lib.cjs");
const { robinhoodNetworkExternals } = require("./lib/robinhood-chainlink-feeds.cjs");
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
  if (chainId === 4663) {
    const rh = robinhoodNetworkExternals();
    if (!process.env.UMA_OOV2?.trim()) {
      console.warn(
        "Robinhood: UMA_OOV2 not set — price markets deploy fine; set a real OO before creating event (UMA) markets.",
      );
    }
    return {
      oo: rh.oo,
      circleUsdc: rh.circleUsdc,
      weth: rh.weth,
      usdg: rh.usdg,
      deployLocalWeth: false,
      registerCircleUsdc: false,
      ethFeed: rh.ethFeed,
      chainlinkFeeds: rh.chainlinkFeeds,
      vaultCollateralOptions: rh.vaultCollateralOptions,
      pons: rh.pons,
    };
  }
  if (chainId === 1301) {
    console.warn(
      "Unichain Sepolia: no public Chainlink feeds — deploy will create MockWETH + MockChainlinkFeed (ETH/BTC).",
    );
    return {
      oo: process.env.UMA_OOV2?.trim() || "0x0000000000000000000000000000000000000001",
      circleUsdc: process.env.UMA_BOND_CURRENCY?.trim() || null,
      deployLocalWeth: true,
      deployMockFeeds: true,
      registerCircleUsdc: Boolean(process.env.UMA_BOND_CURRENCY?.trim()),
      ethFeed: null,
      chainlinkFeeds: [],
    };
  }
  throw new Error(
    `Unsupported chainId ${chainId}. Add networkExternals() mapping or use baseSepolia / monadTestnet / robinhoodMainnet / unichainSepolia.`,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deploy a contract and return { instance, address, blockNumber }.
 * blockNumber is the block the deployment tx was mined in.
 */
/**
 * Deploy a contract and return { instance, address, blockNumber }.
 * Prefer the Wallet-backed deployAndTrack inside main() on flaky L2 RPCs.
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
  const WethF = await hre_.ethers.getContractFactory("MockWETH", deployer);
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

/** Deploy MockWETH + mock Chainlink feeds (Unichain Sepolia has no public Chainlink). */
async function deployUnichainTestExternals(hre_, deployer, deployAndTrack, deploymentBlocks) {
  console.log("\n[0a] Deploying MockWETH (Unichain Sepolia)...");
  const WethF = await hre_.ethers.getContractFactory("MockWETH", deployer);
  const { instance: weth, address: wethAddress, blockNumber: wethBlock } = await deployAndTrack(WethF);
  deploymentBlocks.MockWETH = wethBlock;
  console.log(`  MockWETH: ${wethAddress} (block ${wethBlock})`);

  console.log("[0b] Deploying MockChainlinkFeed ETH/USD + BTC/USD...");
  const FeedF = await hre_.ethers.getContractFactory("MockChainlinkFeed", deployer);
  const ethAnswer = 3500n * 10n ** 8n;
  const btcAnswer = 100_000n * 10n ** 8n;
  const { address: ethFeed, blockNumber: ethFeedBlock } = await deployAndTrack(
    FeedF,
    ethAnswer,
    8,
    deployer.address,
  );
  deploymentBlocks.MockEthUsdFeed = ethFeedBlock;
  const { address: btcFeed, blockNumber: btcFeedBlock } = await deployAndTrack(
    FeedF,
    btcAnswer,
    8,
    deployer.address,
  );
  deploymentBlocks.MockBtcUsdFeed = btcFeedBlock;
  console.log(`  MockEthUsdFeed: ${ethFeed} ($${Number(ethAnswer) / 1e8})`);
  console.log(`  MockBtcUsdFeed: ${btcFeed} ($${Number(btcAnswer) / 1e8})`);

  const wrapEth = process.env.UNICHAIN_WRAP_ETH?.trim() || process.env.MONAD_WRAP_MON?.trim();
  const wrapAmount = wrapEth ? hre_.ethers.parseEther(wrapEth) : hre_.ethers.parseEther("0.01");
  try {
    const bal = await hre_.ethers.provider.getBalance(deployer.address);
    if (bal > wrapAmount + hre_.ethers.parseEther("0.005")) {
      const tx = await weth.deposit({ value: wrapAmount });
      await tx.wait();
      console.log(`  Wrapped ${hre_.ethers.formatEther(wrapAmount)} ETH → WETH for deployer`);
    }
  } catch (e) {
    console.warn("  Skipped WETH wrap:", e.shortMessage ?? e.message);
  }

  const chainlinkFeeds = [
    {
      label: "ETH/USD",
      asset: "ETH",
      logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
      address: ethFeed,
    },
    {
      label: "BTC/USD",
      asset: "BTC",
      logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
      address: btcFeed,
    },
  ];

  return {
    weth: wethAddress,
    wethFeed: ethFeed,
    btcFeed,
    ethFeed,
    chainlinkFeeds,
    vaultCollateralOptions: [{ label: "WETH", address: wethAddress }],
    mockFeeds: { MockEthUsdFeed: ethFeed, MockBtcUsdFeed: btcFeed },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [hhDeployer] = await hre.ethers.getSigners();
  const pk = process.env.PRIVATE_KEY?.trim();
  if (!pk) throw new Error("PRIVATE_KEY required");

  // Unichain (and some L2 RPCs) break HardhatEthersProvider nonce caching — use a plain JsonRpcProvider.
  const rpcUrl =
    process.env.RPC_URL?.trim() ||
    (hre.network.config && hre.network.config.url) ||
    "https://unichain-sepolia-rpc.publicnode.com";
  const netProbe = await hre.ethers.provider.getNetwork();
  const chainId = Number(netProbe.chainId);
  const provider =
    chainId === 1301
      ? new hre.ethers.JsonRpcProvider(rpcUrl, chainId)
      : hre.ethers.provider;

  const deployer = new hre.ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  console.log("Deployer:", deployer.address);
  if (deployer.address.toLowerCase() !== hhDeployer.address.toLowerCase()) {
    console.warn(`  Note: Hardhat signer ${hhDeployer.address} differs from PRIVATE_KEY wallet`);
  }
  const latestNonce = await provider.getTransactionCount(deployer.address, "latest");
  const pendingNonce = await provider.getTransactionCount(deployer.address, "pending");
  console.log(`  Chain ${chainId}; nonce latest=${latestNonce} pending=${pendingNonce}`);

  async function deployAndTrack(factory, ...args) {
    const f = factory.connect(deployer);
    // Let Wallet manage nonce against a healthy RPC (publicnode). Do not pass explicit nonce —
    // mixed auto + manual counters race with mint()/set*() calls.
    const instance = await f.deploy(...args);
    const receipt = await instance.deploymentTransaction().wait();
    return { instance, address: await instance.getAddress(), blockNumber: receipt.blockNumber };
  }

  const netExt = networkExternals(chainId);
  const prev = tryReadDeployment(hre.network.name, chainId);

  // Track all deployment blocks for subgraph startBlock configuration.
  const deploymentBlocks = { ...(prev?.deploymentBlocks ?? {}) };

  let monadExternals = null;
  let robinhoodExternals = null;
  let unichainExternals = null;
  if (chainId === 10143 && netExt.deployLocalWeth) {
    monadExternals = await deployMonadTestExternals(hre, deployer, deployAndTrack, deploymentBlocks);
  } else if (chainId === 10143) {
    monadExternals = {
      wethFeed: netExt.ethFeed,
      chainlinkFeeds: netExt.chainlinkFeeds,
    };
  } else if (chainId === 4663) {
    robinhoodExternals = {
      weth: netExt.weth,
      usdg: netExt.usdg,
      wethFeed: netExt.ethFeed,
      chainlinkFeeds: netExt.chainlinkFeeds,
      vaultCollateralOptions: netExt.vaultCollateralOptions,
      pons: netExt.pons,
    };
  } else if (chainId === 1301 && netExt.deployLocalWeth) {
    unichainExternals = await deployUnichainTestExternals(hre, deployer, deployAndTrack, deploymentBlocks);
  }

  const weth =
    process.env.MONAD_WETH?.trim() ||
    process.env.DRP_WETH?.trim() ||
    process.env.ROBINHOOD_WETH?.trim() ||
    process.env.UNICHAIN_WETH?.trim() ||
    monadExternals?.weth ||
    unichainExternals?.weth ||
    robinhoodExternals?.weth ||
    netExt.weth ||
    BASE_SEPOLIA_WETH;

  // Canonical Robinhood USDG (Pons pair detection only — NOT trading collateral unless USE_REAL_USDG=1).
  const realRobinhoodUsdg = robinhoodExternals?.usdg || netExt.usdg || null;
  // Trading collateral: mintable mock by default so we can mint for testing.
  // Set USE_REAL_USDG=1 (or USDG_ADDRESS / ROBINHOOD_USDG) to use a pre-existing token instead.
  const useRealUsdg =
    process.env.USE_REAL_USDG === "1" ||
    Boolean(process.env.USDG_ADDRESS?.trim()) ||
    Boolean(process.env.ROBINHOOD_USDG?.trim());
  let usdgAddr = useRealUsdg
    ? (process.env.USDG_ADDRESS?.trim() ||
      process.env.ROBINHOOD_USDG?.trim() ||
      realRobinhoodUsdg)
    : null;

  const epochDuration = BigInt(process.env.VAULT_EPOCH_DURATION?.trim() || "604800");  // 7 days
  const lockDuration  = BigInt(process.env.VAULT_LOCK_DURATION?.trim()  || "604800");  // 7 days
  const aftrInitialMint = BigInt(process.env.Zedkr_INITIAL_MINT?.trim()  || String(100_000_000n * 10n ** 18n));

  // ── 1. ZedkrUSDC test token ─────────────────────────────────────────────
  console.log("\n[1/7] Deploying ZedkrUSDC (test collateral)...");
  const ZedkrUF = await hre.ethers.getContractFactory("ZedkrUSDC", deployer);
  const { instance: aftrUsdc, address: aftrUsdcAddr, blockNumber: aftrUsdcBlock } =
    await deployAndTrack(ZedkrUF, deployer.address);
  deploymentBlocks.ZedkrUSDC = aftrUsdcBlock;
  console.log(`  ZedkrUSDC: ${aftrUsdcAddr} (block ${aftrUsdcBlock})`);

  const extraUsdcMint = process.env.ZedkrUSDC_EXTRA_MINT?.trim() || "1000000";
  try {
    const extra = BigInt(extraUsdcMint) * 10n ** 6n;
    await (await aftrUsdc.mint(deployer.address, extra)).wait();
    console.log(`  Minted ${extraUsdcMint} extra ZedkrUSDC to deployer`);
  } catch (e) {
    console.warn("  Extra ZedkrUSDC mint skipped:", e.shortMessage ?? e.message);
  }

  if (!usdgAddr) {
    console.log("\n[1b/7] Deploying mintable USDG (mock trading collateral)...");
    const USDGF = await hre.ethers.getContractFactory("USDG", deployer);
    const { instance: usdgToken, address: deployedUsdg, blockNumber: usdgBlock } =
      await deployAndTrack(USDGF, deployer.address);
    usdgAddr = deployedUsdg;
    deploymentBlocks.USDG = usdgBlock;
    console.log(`  USDG (mock): ${usdgAddr} (block ${usdgBlock})`);
    console.log("  Initial supply: 100,000 USDG to deployer");
    if (realRobinhoodUsdg) {
      console.log(`  (canonical Robinhood USDG kept for Pons pairs: ${realRobinhoodUsdg})`);
    }

    const extraUsdgMint = process.env.USDG_EXTRA_MINT?.trim() || "1000000";
    try {
      const extraUsdg = BigInt(extraUsdgMint) * 10n ** 6n;
      await (await usdgToken.mint(deployer.address, extraUsdg)).wait();
      console.log(`  Minted ${extraUsdgMint} extra USDG to deployer`);
    } catch (e) {
      console.warn("  Extra USDG mint skipped:", e.shortMessage ?? e.message);
    }
  } else {
    console.log(`\n[1b/7] Using existing USDG (USE_REAL_USDG / USDG_ADDRESS): ${usdgAddr}`);
  }

  // ── 2. Zedkr governance token ───────────────────────────────────────────
  console.log("\n[2/7] Deploying MONDO token (ZedkrToken)...");
  const ZedkrTokenF = await hre.ethers.getContractFactory("ZedkrToken", deployer);
  const { address: aftrTokenAddr, blockNumber: aftrTokenBlock } =
    await deployAndTrack(ZedkrTokenF, deployer.address, aftrInitialMint);
  deploymentBlocks.ZedkrToken = aftrTokenBlock;
  console.log(`  MONDO: ${aftrTokenAddr} (block ${aftrTokenBlock})`);
  console.log(`  Initial mint: ${(aftrInitialMint / 10n ** 18n).toLocaleString()} MONDO to deployer`);

  // ── 3. ZedkrFeeVault ────────────────────────────────────────────────────
  console.log("\n[3/7] Deploying ZedkrFeeVault...");
  const VaultF = await hre.ethers.getContractFactory("ZedkrFeeVault", deployer);
  const { instance: vault, address: vaultAddr, blockNumber: vaultBlock } =
    await deployAndTrack(VaultF, deployer.address, aftrTokenAddr, epochDuration, lockDuration);
  deploymentBlocks.ZedkrFeeVault = vaultBlock;
  console.log(`  ZedkrFeeVault: ${vaultAddr} (block ${vaultBlock})`);
  console.log(`  Epoch: ${epochDuration}s  Lock: ${lockDuration}s`);

  // ── 4. Vault rewards + FPMM stack ──────────────────────────────────────────
  const resolutionAdmins = loadResolutionAdmins(deployer.address);
  if (resolutionAdmins.length < 3) {
    console.warn(
      "  WARNING: fewer than 3 RESOLUTION_ADMINS — event markets cannot be created until setResolutionAdmins is called.",
    );
  }

  const chainlinkFeedsToRegister =
    (unichainExternals?.chainlinkFeeds?.length ? unichainExternals.chainlinkFeeds : null) ||
    netExt.chainlinkFeeds ||
    [];

  const registerWeth =
    (chainId === 10143 && weth.toLowerCase() !== BASE_SEPOLIA_WETH.toLowerCase()) ||
    chainId === 1301 ||
    chainId === 4663;
  const collateralLabels = ["ZedkrUSDC"];
  if (netExt.registerCircleUsdc && netExt.circleUsdc) collateralLabels.push("Circle USDC");
  if (registerWeth) collateralLabels.push("WETH");
  if (usdgAddr) collateralLabels.push("USDG");

  console.log("\n[4/6] Registering vault reward tokens...");
  await (await vault.addRewardToken(aftrUsdcAddr)).wait();
  if (netExt.registerCircleUsdc && netExt.circleUsdc) {
    await (await vault.addRewardToken(netExt.circleUsdc)).wait();
  }
  if (registerWeth) {
    await (await vault.addRewardToken(weth)).wait();
  }
  if (usdgAddr) {
    await (await vault.addRewardToken(usdgAddr)).wait();
  }
  await (await vault.addRewardToken("0x0000000000000000000000000000000000000000")).wait();
  console.log(`  Vault reward tokens: ${collateralLabels.join(", ")}, native`);

  // ── 5. Zedkr FPMM stack ────────────────────────────────────────────────────
  console.log("\n[5/6] Deploying Zedkr FPMM stack (registry + factory + deployer)...");
  const fpmmCollaterals = [aftrUsdcAddr];
  if (netExt.registerCircleUsdc && netExt.circleUsdc) fpmmCollaterals.push(netExt.circleUsdc);
  if (registerWeth) fpmmCollaterals.push(weth);
  if (usdgAddr) fpmmCollaterals.push(usdgAddr);

  const fpmmBotAdmin = process.env.PONS_RESOLUTION_ADMIN?.trim() || process.env.NAD_RESOLUTION_ADMIN?.trim() || deployer.address;
  const fpmmResult = await deployFpmmStack(hre, deployer, vaultAddr, {
    deployAndTrack,
    deploymentBlocks,
    chainlinkFeeds: chainlinkFeedsToRegister,
    collateralTokens: fpmmCollaterals,
    resolutionAdmins,
    ponsResolutionAdmin: fpmmBotAdmin,
  });

  // ── 6. OrderBook (FPMM via adapter) ─────────────────────────────────────────
  console.log("\n[6/6] Deploying FPMM orderbook adapter + ZedkrOrderBook...");
  const AdapterF = await hre.ethers.getContractFactory("ZedkrFpmmOrderBookFactoryAdapter", deployer);
  const { address: adapterAddress, blockNumber: adapterBlock } =
    await deployAndTrack(AdapterF, fpmmResult.fpmmFactory);
  deploymentBlocks.ZedkrFpmmOrderBookFactoryAdapter = adapterBlock;
  console.log(`  Adapter: ${adapterAddress} (block ${adapterBlock})`);

  const OrderBookF = await hre.ethers.getContractFactory("ZedkrOrderBook", deployer);
  const { address: orderBookAddress, blockNumber: orderBookBlock } =
    await deployAndTrack(OrderBookF, adapterAddress, deployer.address, vaultAddr);
  deploymentBlocks.ZedkrOrderBook = orderBookBlock;
  console.log(`  OrderBook: ${orderBookAddress} (block ${orderBookBlock})`);

  // ── Write deployment JSON ──────────────────────────────────────────────────
  writeDeploymentJson(hre, {
    chainId,
    deployer: deployer.address,
    feeRecipient: vaultAddr,
    contracts: {
      ZedkrToken:                    aftrTokenAddr,
      ZedkrFeeVault:                 vaultAddr,
      ZedkrUSDC:                     aftrUsdcAddr,
      ...(usdgAddr ? { USDG: usdgAddr } : {}),
      ZedkrOrderBook:                orderBookAddress,
      ZedkrFpmmOrderBookFactoryAdapter:  adapterAddress,
      ZedkrCollateralRegistry:           fpmmResult.registry,
      ZedkrFpmmMarketFactory:            fpmmResult.fpmmFactory,
      ZedkrFpmmDeployer:                 fpmmResult.fpmmDeployer,
      ...(registerWeth && (chainId === 10143 || chainId === 1301) ? { MockWETH: weth } : {}),
      ...(chainId === 4663 && weth ? { WETH: weth } : {}),
      ...(unichainExternals?.mockFeeds ?? {}),
    },
    // Block numbers for every contract — used as subgraph startBlock values.
    deploymentBlocks,
    external: {
      optimisticOracleV2:           netExt.oo,
      umaBondCurrencyCircleUSDC:    netExt.circleUsdc || aftrUsdcAddr,
      ...(monadExternals?.chainlinkFeeds ? { chainlinkFeeds: monadExternals.chainlinkFeeds } : {}),
      ...(unichainExternals?.chainlinkFeeds ? { chainlinkFeeds: unichainExternals.chainlinkFeeds } : {}),
      ...(robinhoodExternals?.chainlinkFeeds ? { chainlinkFeeds: robinhoodExternals.chainlinkFeeds } : {}),
      ...(robinhoodExternals?.priceFeedAssets ? { priceFeedAssets: robinhoodExternals.priceFeedAssets } : {}),
      ...(monadExternals?.vaultCollateralOptions
        ? { vaultCollateralOptions: monadExternals.vaultCollateralOptions }
        : {}),
      ...(unichainExternals?.vaultCollateralOptions
        ? { vaultCollateralOptions: unichainExternals.vaultCollateralOptions }
        : {}),
      ...(robinhoodExternals?.vaultCollateralOptions
        ? { vaultCollateralOptions: robinhoodExternals.vaultCollateralOptions }
        : {}),
      // Keep canonical Robinhood USDG on pons.usdg for pair detection; trading mock lives in contracts.USDG.
      ...(robinhoodExternals?.pons
        ? { pons: { ...robinhoodExternals.pons, usdg: realRobinhoodUsdg ?? robinhoodExternals.pons.usdg } }
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
        ...(usdgAddr ? [usdgAddr] : []),
        "0x0000000000000000000000000000000000000000",
      ],
    },
    resolutionAdmins,
    suggestedUmaReward: UMA_REWARD_USDC.toString(),
    notes: {
      tradingCollaterals: collateralLabels,
      fpmmCollaterals: fpmmCollaterals,
      primaryMarketFactory: "ZedkrFpmmMarketFactory",
      orderBook: "ZedkrOrderBook is the FPMM CLOB via ZedkrFpmmOrderBookFactoryAdapter.",
      umaRewardToken: netExt.circleUsdc
        ? "Circle USDC when umaRewardCurrency is address(0) on factory"
        : "ZedkrUSDC when umaRewardCurrency is address(0) on factory",
      feeFlow: "Market buy → protocol fee → ZedkrFeeVault.receiveFees()",
    },
  });

  // ── Subgraph: patch subgraph.yaml from deployment JSON ─────────────────────
  try {
    const root = path.join(__dirname, "..");
    execSync("node scripts/subgraph-update-config.cjs", { cwd: root, stdio: "inherit" });
    console.log("  Patched subgraph/subgraph.yaml (Factory, Vault, OrderBook).");
  } catch (e) {
    console.warn("  subgraph-update-config failed — run: npm run subgraph:update-config", e?.message ?? e);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Deployment complete. Key addresses:");
  console.log(`  ZedkrToken:                   ${aftrTokenAddr}`);
  console.log(`  ZedkrFeeVault:                ${vaultAddr}  ← feeRecipient`);
  console.log(`  ZedkrFpmmMarketFactory:           ${fpmmResult.fpmmFactory}`);
  console.log(`  ZedkrCollateralRegistry:          ${fpmmResult.registry}`);
  console.log(`  ZedkrOrderBook:               ${orderBookAddress}`);
  console.log(`  OrderBook adapter:                ${adapterAddress}`);
  console.log("\nNext steps:");
  console.log("  1. subgraph/subgraph.yaml was updated — run: npm run subgraph:codegen && npm run subgraph:build");
  console.log("  2. Deploy subgraph to Goldsky / Studio");
  console.log("  3. Distribute Zedkr tokens to stakers / liquidity programs.");
  console.log("  4. Create markets from the UI — each market auto-seeds on creation.");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

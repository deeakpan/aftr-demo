/* eslint-disable no-console */
/**
 * Deploy full AFTR stack:
 *   USDeAD + DRP, AFTRUSDC test token, AFTRToken governance token,
 *   AFTRFeeVault (staking vault — becomes feeRecipient),
 *   AFTRParimutuelMarketFactory + AFTRParimutuelDeployer,
 *   AFTROrderBook, AFTRMarketDebtRouter.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-aftr-full-stack.cjs --network baseSepolia
 *
 * Env (optional, defaults to deployer):
 *   DRP_DEFAULT_ADMIN        — USDeAD initial owner
 *   DRP_PARAM_SETTER_ADMIN   — must be able to schedule/execute timelocked ops
 *   VAULT_EPOCH_DURATION     — epoch length in seconds (default: 604800 = 7 days)
 *   VAULT_LOCK_DURATION      — unstake lock in seconds (default: 604800 = 7 days)
 *   AFTR_INITIAL_MINT        — initial AFTR token mint to deployer (default: 100_000_000e18)
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

/** Circle test USDC on Base Sepolia (UMA-whitelisted). */
const BASE_SEPOLIA_CIRCLE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const UMA_REWARD_USDC = 500_000n;

const OOv2_BASE_SEPOLIA = "0x99EC530a761E68a377593888D9504002Bd191717";
const canonicalWeth = "0x4200000000000000000000000000000000000006";
const defaultEthFeed = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1";

/** TimelockOp.SetVaultManager in DeaderalReserveProtocol.sol */
const TIMELOCK_OP_SET_VAULT_MANAGER = 2;

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const defaultAdmin      = process.env.DRP_DEFAULT_ADMIN?.trim()       || deployer.address;
  const paramSetterAdmin  = process.env.DRP_PARAM_SETTER_ADMIN?.trim()  || deployer.address;
  const distro            = process.env.DRP_DISTRO?.trim()              || deployer.address;
  const vaultDistributor  = process.env.DRP_VAULT_DISTRIBUTOR?.trim()   || deployer.address;
  const weth              = process.env.DRP_WETH?.trim()                || canonicalWeth;
  const reth              = process.env.DRP_RETH?.trim()                || weth;
  const wstETH            = process.env.DRP_WSTETH?.trim()              || weth;
  const wethFeed          = process.env.DRP_WETH_FEED?.trim()           || defaultEthFeed;
  const rethFeed          = process.env.DRP_RETH_FEED?.trim()           || defaultEthFeed;
  const wstETHFeed        = process.env.DRP_WSTETH_FEED?.trim()         || defaultEthFeed;

  const epochDuration = BigInt(process.env.VAULT_EPOCH_DURATION?.trim() || "604800");  // 7 days
  const lockDuration  = BigInt(process.env.VAULT_LOCK_DURATION?.trim()  || "604800");  // 7 days
  const aftrInitialMint = BigInt(process.env.AFTR_INITIAL_MINT?.trim()  || String(100_000_000n * 10n ** 18n));

  const prev = tryReadDeployment(hre.network.name, chainId);

  // Track all deployment blocks for subgraph startBlock configuration.
  const deploymentBlocks = { ...(prev?.deploymentBlocks ?? {}) };

  // ── 1. USDeAD ──────────────────────────────────────────────────────────────
  console.log("\n[1/10] Deploying USDeAD...");
  const USDeADF = await hre.ethers.getContractFactory("USDeAD");
  const { instance: usdead, address: usdeadAddress, blockNumber: usdeadBlock } =
    await deployAndTrack(USDeADF, defaultAdmin);
  deploymentBlocks.USDeAD = usdeadBlock;
  console.log(`  USDeAD: ${usdeadAddress} (block ${usdeadBlock})`);

  // ── 2. Mock treasury + stability pool ─────────────────────────────────────
  let treasury = process.env.DRP_TREASURY?.trim();
  if (!treasury) {
    console.log("[2a] Deploying MockTreasurySplitter...");
    const TF = await hre.ethers.getContractFactory("MockTreasurySplitter");
    const { address, blockNumber } = await deployAndTrack(TF);
    treasury = address;
    deploymentBlocks.MockTreasurySplitter = blockNumber;
    console.log(`  MockTreasurySplitter: ${treasury} (block ${blockNumber})`);
  }

  let stabilityPool = process.env.DRP_STABILITY_POOL?.trim();
  if (!stabilityPool) {
    console.log("[2b] Deploying MockStabilityPool...");
    const SPF = await hre.ethers.getContractFactory("MockStabilityPool");
    const { address, blockNumber } = await deployAndTrack(SPF, usdeadAddress, weth, reth, wstETH, defaultAdmin);
    stabilityPool = address;
    deploymentBlocks.MockStabilityPool = blockNumber;
    console.log(`  MockStabilityPool: ${stabilityPool} (block ${blockNumber})`);
  }

  // ── 3. DRP ─────────────────────────────────────────────────────────────────
  console.log("\n[3/10] Deploying DeaderalReserveProtocol...");
  const DRPF = await hre.ethers.getContractFactory("DeaderalReserveProtocol");
  const { instance: drp, address: drpAddress, blockNumber: drpBlock } =
    await deployAndTrack(DRPF, {
      weth, reth, wstETH, wethFeed, rethFeed, wstETHFeed,
      usdead: usdeadAddress, treasury, distro, stabilityPool,
      vaultDistributor, defaultAdmin, paramSetterAdmin,
    });
  deploymentBlocks.DRP = drpBlock;
  console.log(`  DRP: ${drpAddress} (block ${drpBlock})`);

  // Link stability pool → DRP
  const sp = await hre.ethers.getContractAt("MockStabilityPool", stabilityPool);
  try {
    await (await sp.setDRP(drpAddress)).wait();
    console.log("  Linked StabilityPool -> DRP");
  } catch (e) {
    console.log("  Skipped setDRP:", e.shortMessage ?? e.message);
  }

  // Transfer USDeAD ownership to DRP
  if (defaultAdmin.toLowerCase() === deployer.address.toLowerCase()) {
    await (await usdead.transferOwnership(drpAddress)).wait();
    console.log("  Transferred USDeAD ownership to DRP");
  }

  // ── 4. AFTRUSDC test token ─────────────────────────────────────────────────
  console.log("\n[4/10] Deploying AFTRUSDC (test collateral)...");
  const AFTRUF = await hre.ethers.getContractFactory("AFTRUSDC");
  const { address: aftrUsdcAddr, blockNumber: aftrUsdcBlock } =
    await deployAndTrack(AFTRUF, deployer.address);
  deploymentBlocks.AFTRUSDC = aftrUsdcBlock;
  console.log(`  AFTRUSDC: ${aftrUsdcAddr} (block ${aftrUsdcBlock})`);

  // ── 5. AFTR governance token ───────────────────────────────────────────────
  console.log("\n[5/10] Deploying AFTRToken (governance token)...");
  const AFTRTokenF = await hre.ethers.getContractFactory("AFTRToken");
  const { address: aftrTokenAddr, blockNumber: aftrTokenBlock } =
    await deployAndTrack(AFTRTokenF, deployer.address, aftrInitialMint);
  deploymentBlocks.AFTRToken = aftrTokenBlock;
  console.log(`  AFTRToken: ${aftrTokenAddr} (block ${aftrTokenBlock})`);
  console.log(`  Initial mint: ${(aftrInitialMint / 10n ** 18n).toLocaleString()} AFTR to deployer`);

  // ── 6. AFTRFeeVault ────────────────────────────────────────────────────────
  console.log("\n[6/10] Deploying AFTRFeeVault...");
  const VaultF = await hre.ethers.getContractFactory("AFTRFeeVault");
  const { instance: vault, address: vaultAddr, blockNumber: vaultBlock } =
    await deployAndTrack(VaultF, deployer.address, aftrTokenAddr, epochDuration, lockDuration);
  deploymentBlocks.AFTRFeeVault = vaultBlock;
  console.log(`  AFTRFeeVault: ${vaultAddr} (block ${vaultBlock})`);
  console.log(`  Epoch: ${epochDuration}s  Lock: ${lockDuration}s`);

  // ── 7. Factory ─────────────────────────────────────────────────────────────
  // feeRecipient = vault so protocol fees flow into the staking accumulator.
  console.log("\n[7/10] Deploying AFTRParimutuelMarketFactory...");
  const FactoryF = await hre.ethers.getContractFactory("AFTRParimutuelMarketFactory");
  const { instance: factory, address: factoryAddress, blockNumber: factoryBlock } =
    await deployAndTrack(FactoryF, deployer.address, vaultAddr, OOv2_BASE_SEPOLIA, BASE_SEPOLIA_CIRCLE_USDC);
  deploymentBlocks.AFTRParimutuelMarketFactory = factoryBlock;
  console.log(`  Factory: ${factoryAddress} (block ${factoryBlock})`);
  console.log(`  feeRecipient = vault (${vaultAddr})`);

  // ── 8. Deployer lib ────────────────────────────────────────────────────────
  console.log("\n[8/10] Deploying AFTRParimutuelDeployer...");
  const DeployerLibF = await hre.ethers.getContractFactory("AFTRParimutuelDeployer");
  const { address: marketDeployerAddress, blockNumber: deployerBlock } =
    await deployAndTrack(DeployerLibF, factoryAddress);
  deploymentBlocks.AFTRParimutuelDeployer = deployerBlock;
  console.log(`  Deployer: ${marketDeployerAddress} (block ${deployerBlock})`);

  await (await factory.setMarketDeployer(marketDeployerAddress)).wait();
  console.log("  Linked factory.marketDeployer");

  // Register collaterals
  console.log("  Registering collaterals: AFTRUSDC, USDeAD, Circle USDC");
  await (await factory.addSupportedCollateral(aftrUsdcAddr)).wait();
  await (await factory.addSupportedCollateral(usdeadAddress)).wait();
  await (await factory.addSupportedCollateral(BASE_SEPOLIA_CIRCLE_USDC)).wait();

  // Register vault reward tokens (one per supported collateral + ETH)
  console.log("  Registering vault reward tokens...");
  await (await vault.addRewardToken(aftrUsdcAddr)).wait();
  await (await vault.addRewardToken(usdeadAddress)).wait();
  await (await vault.addRewardToken(BASE_SEPOLIA_CIRCLE_USDC)).wait();
  // Native ETH (address(0)) for ETH-collateral markets
  await (await vault.addRewardToken("0x0000000000000000000000000000000000000000")).wait();
  console.log("  Vault reward tokens: AFTRUSDC, USDeAD, Circle USDC, ETH");

  // ── 9. OrderBook ───────────────────────────────────────────────────────────
  console.log("\n[9/10] Deploying AFTROrderBook...");
  const OrderBookF = await hre.ethers.getContractFactory("AFTROrderBook");
  const { address: orderBookAddress, blockNumber: orderBookBlock } =
    await deployAndTrack(OrderBookF, factoryAddress, deployer.address, deployer.address);
  deploymentBlocks.AFTROrderBook = orderBookBlock;
  console.log(`  OrderBook: ${orderBookAddress} (block ${orderBookBlock})`);

  // ── 10. Router ─────────────────────────────────────────────────────────────
  console.log("\n[10/10] Deploying AFTRMarketDebtRouter...");
  const RouterF = await hre.ethers.getContractFactory("AFTRMarketDebtRouter");
  const { address: routerAddress, blockNumber: routerBlock } =
    await deployAndTrack(RouterF, factoryAddress, drpAddress);
  deploymentBlocks.AFTRMarketDebtRouter = routerBlock;
  console.log(`  Router: ${routerAddress} (block ${routerBlock})`);

  // ── Write deployment JSON ──────────────────────────────────────────────────
  writeDeploymentJson(hre, {
    chainId,
    deployer: deployer.address,
    feeRecipient: vaultAddr,
    contracts: {
      AFTRToken:                    aftrTokenAddr,
      AFTRFeeVault:                 vaultAddr,
      AFTRUSDC:                     aftrUsdcAddr,
      USDeAD:                       usdeadAddress,
      DRP:                          drpAddress,
      AFTRParimutuelMarketFactory:  factoryAddress,
      AFTRParimutuelDeployer:       marketDeployerAddress,
      AFTROrderBook:                orderBookAddress,
      AFTRMarketDebtRouter:         routerAddress,
    },
    // Block numbers for every contract — used as subgraph startBlock values.
    deploymentBlocks,
    external: {
      optimisticOracleV2:           OOv2_BASE_SEPOLIA,
      umaBondCurrencyCircleUSDC:    BASE_SEPOLIA_CIRCLE_USDC,
    },
    vault: {
      stakeToken:    aftrTokenAddr,
      epochDuration: epochDuration.toString(),
      lockDuration:  lockDuration.toString(),
      rewardTokens: [aftrUsdcAddr, usdeadAddress, BASE_SEPOLIA_CIRCLE_USDC, "0x0000000000000000000000000000000000000000"],
    },
    suggestedUmaReward: UMA_REWARD_USDC.toString(),
    notes: {
      tradingCollaterals: ["AFTRUSDC", "USDeAD", "Circle_Base_Sepolia_USDC"],
      umaRewardToken: "Circle Base Sepolia USDC when umaRewardCurrency is address(0) on factory",
      feeFlow: "Market deposit → 1.2% → AFTRFeeVault.receiveFees() → 0.2% stakers / 1.0% treasury",
      drpApproval: "After deploying markets, call market.approveDrp(DRP_ADDRESS) for each market that should support redeemAndRepayDebt",
    },
  });

  // ── DRP: whitelist router as vault manager ─────────────────────────────────
  const signerIsParamSetter = paramSetterAdmin.toLowerCase() === deployer.address.toLowerCase();
  if (!signerIsParamSetter) {
    console.warn(
      "\nDeployer !== DRP_PARAM_SETTER_ADMIN — run npm run drp:enable-router-manager with that admin:",
      routerAddress,
    );
  } else {
    console.log("\nScheduling + executing TimelockOp.SetVaultManager on DRP...");
    try {
      const trustedBefore = await drp.trustedManagers(routerAddress);
      if (!trustedBefore) {
        await (await drp.schedule(TIMELOCK_OP_SET_VAULT_MANAGER, routerAddress, 1)).wait();
        await new Promise((r) => setTimeout(r, 4500));
        await (await drp.executeOp(TIMELOCK_OP_SET_VAULT_MANAGER)).wait();
        const trustedNow = await drp.trustedManagers(routerAddress);
        console.log("  Router trustedManagers:", trustedNow);
      } else {
        console.log("  Router already trusted on DRP");
      }
    } catch (e) {
      console.warn(
        "  Could not whitelist router via timelock. Run:\n",
        `  npm run drp:enable-router-manager -- --network ${hre.network.name}\n`,
        e?.shortMessage || e?.message || e,
      );
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Deployment complete. Key addresses:");
  console.log(`  AFTRToken:                   ${aftrTokenAddr}`);
  console.log(`  AFTRFeeVault:                ${vaultAddr}  ← feeRecipient`);
  console.log(`  AFTRParimutuelMarketFactory: ${factoryAddress}`);
  console.log(`  AFTRMarketDebtRouter:        ${routerAddress}`);
  console.log(`  AFTROrderBook:               ${orderBookAddress}`);
  console.log("\nNext steps:");
  console.log("  1. Update subgraph/subgraph.yaml with addresses + startBlocks from deploymentBlocks.");
  console.log("  2. Distribute AFTR tokens to stakers / liquidity programs.");
  console.log("  3. Create markets from the UI — each market auto-seeds on creation.");
  console.log("  4. For DRP-integrated markets: call market.approveDrp(DRP_ADDRESS).");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

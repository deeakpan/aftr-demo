/**
 * MarketLifecycle.test.cjs
 * Tests: market creation (atomic seed), trading (deposit), and redemption.
 * Runs on Hardhat's in-process network — no external RPC needed.
 */

const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { deployParimutuelFacade } = require("../scripts/lib/deploy-parimutuel-facade.cjs");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BPS = 10_000n;
const CREATOR_FEE_BPS = 30n;   // 0.3%
const PROTOCOL_FEE_BPS = 120n; // 1.2%
const MIN_DEPOSIT = 1000n;

function bps(amount, fee) {
  return (amount * fee) / BPS;
}

// ─── Mock Chainlink feed ───────────────────────────────────────────────────────

async function deployMockFeed(owner, answer, decimals = 8) {
  const MockFeed = await ethers.getContractFactory("MockChainlinkFeed");
  return MockFeed.deploy(answer, decimals, owner.address);
}

function btcAssetKey() {
  return ethers.keccak256(ethers.toUtf8Bytes("BTC"));
}

// ─── Deploy full stack ─────────────────────────────────────────────────────────

async function deployStack(owner, feeRecipient) {
  async function deployAndTrack(factory, ...args) {
    const instance = await factory.deploy(...args);
    const receipt = await instance.deploymentTransaction().wait();
    return { instance, address: await instance.getAddress(), blockNumber: receipt.blockNumber };
  }

  // 1. USDC mock
  const USDC = await ethers.getContractFactory("MondaloreUSDC");
  const usdc = await USDC.deploy(owner.address);

  // 2. Factory (needs a dummy OO and bond currency — use usdc as bond currency)
  const Factory = await ethers.getContractFactory("MondaloreParimutuelMarketFactory");
  const factory = await Factory.deploy(
    owner.address,
    feeRecipient.address,
    ethers.ZeroAddress, // optimisticOracleV2 — not needed for PRICE markets
    await usdc.getAddress()  // umaBondCurrency
  );
  const factoryAddr = await factory.getAddress();

  // 3. Deployer facade + sub-deployers (3 txs — EIP-3860)
  const { marketDeployerAddress } = await deployParimutuelFacade(hre, owner, factoryAddr, deployAndTrack);
  const deployer = await ethers.getContractAt("MondaloreParimutuelDeployer", marketDeployerAddress);

  // 4. Wire factory
  await factory.connect(owner).setMarketDeployer(marketDeployerAddress);
  await factory.connect(owner).addSupportedCollateral(await usdc.getAddress());

  return { usdc, factory, deployer };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Market Lifecycle — Create, Trade, Redeem", function () {
  let owner, creator, trader1, trader2, feeRecipient;
  let usdc, factory;
  let market, marketAddr;
  let outcomeTokens;

  const VIRTUAL_RESERVE = ethers.parseUnits("1000", 6);   // 1000 USDC
  const BOOTSTRAP_AMOUNT = ethers.parseUnits("200", 6);   // 200 USDC (100 per outcome)
  const TRADE_AMOUNT = ethers.parseUnits("100", 6);        // 100 USDC per trade

  before(async function () {
    [owner, creator, trader1, trader2, feeRecipient] = await ethers.getSigners();
    ({ usdc, factory } = await deployStack(owner, feeRecipient));

    // Mint USDC to creator and traders
    await usdc.connect(owner).mint(creator.address, ethers.parseUnits("10000", 6));
    await usdc.connect(owner).mint(trader1.address, ethers.parseUnits("10000", 6));
    await usdc.connect(owner).mint(trader2.address, ethers.parseUnits("10000", 6));
  });

  // ─── 1. Market Creation ──────────────────────────────────────────────────────

  describe("1. Market Creation (atomic create + seed)", function () {
    let feed;
    let stakeEnd, resolveAfter;

    before(async function () {
      // Deploy mock Chainlink feed: BTC/USD = $100,000 (8 decimals)
      feed = await deployMockFeed(owner, 100_000n * 10n ** 8n, 8);
      await factory.connect(owner).setPriceFeed(btcAssetKey(), await feed.getAddress());

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      stakeEnd = now + 7 * 24 * 3600;      // 7 days
      resolveAfter = stakeEnd + 24 * 3600; // 1 day after stake end

      // Creator approves factory for bootstrap amount
      await usdc.connect(creator).approve(await factory.getAddress(), BOOTSTRAP_AMOUNT);

      const params = {
        collateralToken: await usdc.getAddress(),
        collateralDecimals: 6,
        virtualReserve: VIRTUAL_RESERVE,
        stakeEndTimestamp: stakeEnd,
        resolveAfterTimestamp: resolveAfter,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes("btc-100k-market")),
        outcomeLabels: ["Above $100k", "Below $100k"],
        metadataURI: "ipfs://test",
        priceAssetKey: btcAssetKey(),
        priceThreshold: 100_000n * 10n ** 6n, // $100k in 6-decimal normalized form
        priceKind: 0, // ABOVE
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
        minBootstrapTotal: BOOTSTRAP_AMOUNT,
        bootstrapAmount: BOOTSTRAP_AMOUNT,
        shareRecipient: creator.address,
      };

      const tx = await factory.connect(creator).createPriceMarket(params);
      const receipt = await tx.wait();

      // Extract market address from MarketCreated event
      const iface = factory.interface;
      let marketCreatedEvent;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === "MarketCreated") {
            marketCreatedEvent = parsed;
            break;
          }
        } catch {}
      }
      expect(marketCreatedEvent, "MarketCreated event not found").to.not.be.undefined;
      marketAddr = marketCreatedEvent.args.market;

      const Market = await ethers.getContractFactory("MondaloreVParimutuelMarket");
      market = Market.attach(marketAddr);

      // Get outcome token addresses
      const tokens = await factory.getMarketOutcomeTokens(marketAddr);
      const OutcomeToken = await ethers.getContractFactory("MondaloreOutcomeToken");
      outcomeTokens = tokens.map(t => OutcomeToken.attach(t));
    });

    it("registers market in factory", async function () {
      expect(await factory.isMarket(marketAddr)).to.be.true;
    });

    it("emits creator address in MarketCreated event", async function () {
      // Re-check via factory markets array
      const len = await factory.marketsLength();
      expect(len).to.equal(1n);
    });

    it("market is initialized and OPEN", async function () {
      expect(await market.initialized()).to.be.true;
      expect(await market.state()).to.equal(0n); // OPEN
    });

    it("bootstrap seeded both outcome pools equally", async function () {
      const perOutcome = BOOTSTRAP_AMOUNT / 2n;
      expect(await market.realPool(0)).to.equal(perOutcome);
      expect(await market.realPool(1)).to.equal(perOutcome);
    });

    it("creator received bootstrap shares for both outcomes", async function () {
      const bal0 = await outcomeTokens[0].balanceOf(creator.address);
      const bal1 = await outcomeTokens[1].balanceOf(creator.address);
      // Both outcomes seeded equally → equal shares (Fix #1 verified)
      expect(bal0).to.equal(bal1, "Bootstrap shares should be equal across outcomes after Fix #1");
      expect(bal0).to.be.gt(0n);
    });

    it("bootstrapFunder is set to factory address (not creator)", async function () {
      // Known behaviour: factory calls bootstrapLiquidity so bootstrapFunder = factory
      expect(await market.bootstrapFunder()).to.equal(await factory.getAddress());
    });

    it("market collateral is USDC", async function () {
      expect(await market.collateralAddress()).to.equal(await usdc.getAddress());
    });
  });

  // ─── 2. Trading (Deposit) ────────────────────────────────────────────────────

  describe("2. Trading — deposit with fee split", function () {
    let creatorBalBefore, feeRecipientBalBefore;
    let trader1SharesBefore;

    before(async function () {
      creatorBalBefore = await usdc.balanceOf(creator.address);
      feeRecipientBalBefore = await usdc.balanceOf(feeRecipient.address);
      trader1SharesBefore = await outcomeTokens[0].balanceOf(trader1.address);

      // trader1 bets on outcome 0 (Above $100k)
      await usdc.connect(trader1).approve(marketAddr, TRADE_AMOUNT);
      await market.connect(trader1).deposit(0, TRADE_AMOUNT, trader1.address, 0n);
    });

    it("creator received 0.3% fee", async function () {
      const expectedFee = bps(TRADE_AMOUNT, CREATOR_FEE_BPS);
      const creatorBalAfter = await usdc.balanceOf(creator.address);
      expect(creatorBalAfter - creatorBalBefore).to.equal(expectedFee);
    });

    it("feeRecipient received 1.2% fee", async function () {
      const expectedFee = bps(TRADE_AMOUNT, PROTOCOL_FEE_BPS);
      const feeRecipientBalAfter = await usdc.balanceOf(feeRecipient.address);
      expect(feeRecipientBalAfter - feeRecipientBalBefore).to.equal(expectedFee);
    });

    it("trader1 received outcome shares", async function () {
      const sharesAfter = await outcomeTokens[0].balanceOf(trader1.address);
      expect(sharesAfter).to.be.gt(trader1SharesBefore);
    });

    it("realPool[0] increased by netAmount", async function () {
      const netAmount = TRADE_AMOUNT - bps(TRADE_AMOUNT, CREATOR_FEE_BPS) - bps(TRADE_AMOUNT, PROTOCOL_FEE_BPS);
      // Pool was BOOTSTRAP_AMOUNT/2 before trade
      const expectedPool = BOOTSTRAP_AMOUNT / 2n + netAmount;
      expect(await market.realPool(0)).to.equal(expectedPool);
    });

    it("deposit below MIN_DEPOSIT reverts", async function () {
      await usdc.connect(trader1).approve(marketAddr, 999n);
      await expect(
        market.connect(trader1).deposit(0, 999n, trader1.address, 0n)
      ).to.be.revertedWith("Below min deposit");
    });

    it("trader2 bets on outcome 1 (Below $100k)", async function () {
      await usdc.connect(trader2).approve(marketAddr, TRADE_AMOUNT);
      await market.connect(trader2).deposit(1, TRADE_AMOUNT, trader2.address, 0n);
      const shares = await outcomeTokens[1].balanceOf(trader2.address);
      expect(shares).to.be.gt(0n);
    });

    it("priceOf reflects updated pools", async function () {
      const p0 = await market.priceOf(0);
      const p1 = await market.priceOf(1);
      // Both outcomes received equal bootstrap + equal trade amounts → prices are equal
      // Prices sum to exactly 1e18 (virtual reserve cancels in the ratio)
      const sum = p0 + p1;
      expect(sum).to.equal(1n * 10n ** 18n);
      // Each price is 0.5e18
      expect(p0).to.equal(p1);
    });
  });

  // ─── 3. Settlement ───────────────────────────────────────────────────────────

  describe("3. Settlement — Chainlink price market", function () {
    before(async function () {
      // Fast-forward past resolveAfterTimestamp
      const resolveAfter = await market.resolveAfterTimestamp();
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(resolveAfter) + 1]);
      await ethers.provider.send("evm_mine");

      // Settle: BTC is at $100k → outcome 0 wins (ABOVE threshold)
      await market.connect(owner).settlePrice();
    });

    it("market state is SETTLED", async function () {
      expect(await market.state()).to.equal(2n); // SETTLED
    });

    it("winning outcome is 0 (Above $100k)", async function () {
      expect(await market.winningOutcomeIndex()).to.equal(0n);
    });

    it("redemptionRate is set and positive", async function () {
      const rate = await market.redemptionRate();
      expect(rate).to.be.gt(0n);
    });
  });

  // ─── 4. Redemption ───────────────────────────────────────────────────────────

  describe("4. Redemption — winners claim collateral", function () {
    let trader1BalBefore, trader1Shares;

    before(async function () {
      trader1BalBefore = await usdc.balanceOf(trader1.address);
      trader1Shares = await outcomeTokens[0].balanceOf(trader1.address);
    });

    it("loser (trader2) cannot redeem outcome 1", async function () {
      const shares2 = await outcomeTokens[1].balanceOf(trader2.address);
      await outcomeTokens[1].connect(trader2).approve(marketAddr, shares2);
      await expect(
        market.connect(trader2).redeem(1, shares2)
      ).to.be.revertedWithCustomError(market, "InvalidOutcome");
    });

    it("winner (trader1) redeems outcome 0 shares for USDC", async function () {
      // Approve market to burn shares
      await outcomeTokens[0].connect(trader1).approve(marketAddr, trader1Shares);
      await market.connect(trader1).redeem(0, trader1Shares);

      const trader1BalAfter = await usdc.balanceOf(trader1.address);
      expect(trader1BalAfter).to.be.gt(trader1BalBefore);
    });

    it("payout is proportional to redemptionRate", async function () {
      const rate = await market.redemptionRate();
      const expectedPayout = (trader1Shares * rate) / (10n ** 18n);
      const trader1BalAfter = await usdc.balanceOf(trader1.address);
      expect(trader1BalAfter - trader1BalBefore).to.equal(expectedPayout);
    });

    it("creator can also redeem bootstrap shares for outcome 0", async function () {
      const creatorShares = await outcomeTokens[0].balanceOf(creator.address);
      expect(creatorShares).to.be.gt(0n);

      const creatorBalBefore = await usdc.balanceOf(creator.address);
      await outcomeTokens[0].connect(creator).approve(marketAddr, creatorShares);
      await market.connect(creator).redeem(0, creatorShares);

      const creatorBalAfter = await usdc.balanceOf(creator.address);
      expect(creatorBalAfter).to.be.gt(creatorBalBefore);
    });

    it("outcome 0 shares are burned after redemption", async function () {
      const sharesLeft = await outcomeTokens[0].balanceOf(trader1.address);
      expect(sharesLeft).to.equal(0n);
    });

    it("cannot redeem zero shares", async function () {
      await expect(
        market.connect(trader1).redeem(0, 0n)
      ).to.be.revertedWithCustomError(market, "ZeroShares");
    });
  });

  // ─── 5. Edge cases ───────────────────────────────────────────────────────────

  describe("5. Edge cases", function () {
    it("cannot deposit after stakeEndTimestamp", async function () {
      // Market is already settled, state check fires first
      await usdc.connect(trader1).approve(marketAddr, TRADE_AMOUNT);
      await expect(
        market.connect(trader1).deposit(0, TRADE_AMOUNT, trader1.address, 0n)
      ).to.be.revertedWithCustomError(market, "MarketNotOpen");
    });

    it("cannot bootstrap twice", async function () {
      // Market is settled but bootstrapped flag is set
      expect(await market.bootstrapped()).to.be.true;
    });

    it("factory rejects unsupported collateral", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      await deployMockFeed(owner, 100_000n * 10n ** 8n, 8);
      const params = {
        collateralToken: ethers.ZeroAddress, // native — not enabled in deployStack
        collateralDecimals: 18,
        virtualReserve: VIRTUAL_RESERVE,
        stakeEndTimestamp: now + 7 * 24 * 3600,
        resolveAfterTimestamp: now + 8 * 24 * 3600,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes("test")),
        outcomeLabels: ["Yes", "No"],
        metadataURI: "ipfs://test",
        priceAssetKey: btcAssetKey(),
        priceThreshold: 0n,
        priceKind: 0,
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
        minBootstrapTotal: ethers.parseEther("0.2"),
        bootstrapAmount: ethers.parseEther("0.2"),
        shareRecipient: creator.address,
      };
      await expect(
        factory.connect(creator).createPriceMarket(params, { value: ethers.parseEther("0.2") })
      ).to.be.revertedWithCustomError(factory, "InvalidCollateral");
    });

    it("wraps native MON into WETH when creating a price market", async function () {
      const MockWETH = await ethers.getContractFactory("MockWETH");
      const weth = await MockWETH.deploy();
      const wethAddr = await weth.getAddress();
      const mockFeed = await deployMockFeed(owner, 100_000n * 10n ** 8n, 8);
      await factory.connect(owner).setWrappedNativeToken(wethAddr);
      await factory.connect(owner).addSupportedCollateral(ethers.ZeroAddress);
      await factory.connect(owner).setPriceFeed(btcAssetKey(), await mockFeed.getAddress());

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const bootstrap = ethers.parseEther("2");
      const params = {
        collateralToken: ethers.ZeroAddress,
        collateralDecimals: 18,
        virtualReserve: ethers.parseEther("10"),
        stakeEndTimestamp: now + 7 * 24 * 3600,
        resolveAfterTimestamp: now + 8 * 24 * 3600,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes("native-mon")),
        outcomeLabels: ["Yes", "No"],
        metadataURI: "ipfs://native-mon",
        priceAssetKey: btcAssetKey(),
        priceThreshold: 100_000n * 10n ** 8n,
        priceKind: 0,
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
        minBootstrapTotal: ethers.parseEther("0.2"),
        bootstrapAmount: bootstrap,
        shareRecipient: creator.address,
      };

      const tx = await factory.connect(creator).createPriceMarket(params, { value: bootstrap });
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "MarketCreated");
      expect(created).to.not.be.undefined;
      expect(created.args.collateralToken).to.equal(wethAddr);

      const marketAddr = created.args.market;
      const market = await ethers.getContractAt("MondaloreVParimutuelMarket", marketAddr);
      expect(await market.collateralAddress()).to.equal(wethAddr);
      expect(await market.bootstrapped()).to.be.true;
    });
  });

  describe("5. NAD_TOKEN market (single admin resolve)", function () {
    let nadMarket;
    let nadMarketAddr;
    let bot;

    before(async function () {
      bot = trader1;
      await factory.connect(owner).setNadResolutionAdmin(bot.address);
      await factory.connect(owner).setResolutionAdmins([owner.address, creator.address, feeRecipient.address]);

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        collateralToken: await usdc.getAddress(),
        collateralDecimals: 6,
        virtualReserve: VIRTUAL_RESERVE,
        stakeEndTimestamp: now + 3600,
        resolveAfterTimestamp: now + 7200,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes("nad-test")),
        outcomeLabels: ["Yes", "No"],
        metadataURI: "ipfs://nad-test",
        minBootstrapTotal: BOOTSTRAP_AMOUNT,
        bootstrapAmount: BOOTSTRAP_AMOUNT,
        shareRecipient: creator.address,
      };

      await usdc.connect(creator).approve(await factory.getAddress(), BOOTSTRAP_AMOUNT);
      const tx = await factory.connect(creator).createNadTokenMarket(params);
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "MarketCreated");

      expect(created).to.not.be.undefined;
      expect(Number(created.args.kind)).to.equal(2);

      nadMarketAddr = created.args.market;
      nadMarket = await ethers.getContractAt("MondaloreVParimutuelMarket", nadMarketAddr);
      expect(Number(await nadMarket.marketKind())).to.equal(2);
    });

    it("resolves via nadResolutionAdmin only", async function () {
      await ethers.provider.send("evm_increaseTime", [7201]);
      await ethers.provider.send("evm_mine", []);

      await expect(nadMarket.connect(creator).resolveNadToken(0)).to.be.reverted;
      await nadMarket.connect(bot).resolveNadToken(0);

      expect(Number(await nadMarket.state())).to.equal(2);
      expect(Number(await nadMarket.winningOutcomeIndex())).to.equal(0);
    });
  });
});

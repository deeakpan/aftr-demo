/**
 * ZedkrFpmm.test.cjs — FPMM markets vs Zedkr resolution (PRICE / EVENT / PONS), USDG collateral.
 */

const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const BPS = 10_000n;
const CREATOR_FEE_BPS = 60n;
const PROTOCOL_FEE_BPS = 40n;
const MIN_TRADE = 1000n;

function bps(amount, fee) {
  return (amount * fee) / BPS;
}

function btcAssetKey() {
  return ethers.keccak256(ethers.toUtf8Bytes("BTC"));
}

async function deployMockFeed(owner, answer, decimals = 8) {
  const MockFeed = await ethers.getContractFactory("MockChainlinkFeed");
  return MockFeed.deploy(answer, decimals, owner.address);
}

async function deployFpmmStack(owner, feeRecipient) {
  const Registry = await ethers.getContractFactory("ZedkrCollateralRegistry");
  const registry = await Registry.deploy(owner.address);

  const USDG = await ethers.getContractFactory("MockUSDG");
  const usdg = await USDG.deploy(owner.address);

  const Factory = await ethers.getContractFactory("ZedkrFpmmMarketFactory");
  const factory = await Factory.deploy(owner.address, feeRecipient.address, await registry.getAddress());

  const Deployer = await ethers.getContractFactory("ZedkrFpmmDeployer");
  const deployer = await Deployer.deploy(await factory.getAddress());

  await factory.connect(owner).setMarketDeployer(await deployer.getAddress());
  await registry.connect(owner).whitelistCollateral(await usdg.getAddress());

  return { registry, usdg, factory, deployer };
}

async function signEventResolution(signer, marketAddr, outcomeIndex, chainId) {
  const domain = {
    name: "Zedkr Market",
    version: "1",
    chainId,
    verifyingContract: marketAddr,
  };
  const types = {
    EventResolution: [
      { name: "market", type: "address" },
      { name: "outcomeIndex", type: "uint8" },
      { name: "chainId", type: "uint256" },
    ],
  };
  const value = {
    market: marketAddr,
    outcomeIndex,
    chainId,
  };
  return signer.signTypedData(domain, types, value);
}

describe("Zedkr FPMM — USDG collateral + resolution", function () {
  let owner, creator, trader1, trader2, feeRecipient;
  let admin1, admin2, admin3;
  let usdg, factory, registry;

  const INITIAL_FUNDING = ethers.parseUnits("200", 6);
  const MIN_FUNDING = ethers.parseUnits("100", 6);
  const TRADE_AMOUNT = ethers.parseUnits("50", 6);

  before(async function () {
    [owner, creator, trader1, trader2, feeRecipient, admin1, admin2, admin3] = await ethers.getSigners();
    ({ usdg, factory, registry } = await deployFpmmStack(owner, feeRecipient));

    await usdg.connect(owner).mint(creator.address, ethers.parseUnits("100000", 6));
    await usdg.connect(owner).mint(trader1.address, ethers.parseUnits("100000", 6));
    await usdg.connect(owner).mint(trader2.address, ethers.parseUnits("100000", 6));

    await factory.connect(owner).setResolutionAdmins([
      admin1.address,
      admin2.address,
      admin3.address,
    ]);
    await factory.connect(owner).setPonsResolutionAdmin(trader1.address);
  });

  describe("Collateral registry", function () {
    it("rejects unwhitelisted collateral", async function () {
      const USDC = await ethers.getContractFactory("MondaloreUSDC");
      const usdc = await USDC.deploy(owner.address);
      const now = (await ethers.provider.getBlock("latest")).timestamp;

      const params = {
        base: {
          collateralToken: await usdc.getAddress(),
          collateralDecimals: 6,
          stakeEndTimestamp: now + 3600,
          resolveAfterTimestamp: now + 7200,
          metadataHash: ethers.keccak256(ethers.toUtf8Bytes("bad-collateral")),
          outcomeLabels: ["Yes", "No"],
          metadataURI: "ipfs://test",
          minInitialFunding: MIN_FUNDING,
          initialFunding: INITIAL_FUNDING,
          fundingHint: [],
          shareRecipient: creator.address,
        },
        priceAssetKey: btcAssetKey(),
        priceThreshold: 100_000n * 10n ** 6n,
        priceKind: 0,
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
      };

      await usdc.connect(owner).mint(creator.address, INITIAL_FUNDING);
      await usdc.connect(creator).approve(await factory.getAddress(), INITIAL_FUNDING);
      await expect(factory.connect(creator).createPriceMarket(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidCollateral"
      );
    });

    it("accepts whitelisted USDG", async function () {
      expect(await registry.isWhitelisted(await usdg.getAddress())).to.be.true;
    });
  });

  describe("PRICE market — FPMM trade + Chainlink settle", function () {
    let market;
    let marketAddr;
    let outcomeTokens;
    let feed;

    before(async function () {
      feed = await deployMockFeed(owner, 100_000n * 10n ** 8n, 8);
      await factory.connect(owner).setPriceFeed(btcAssetKey(), await feed.getAddress());

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        base: {
          collateralToken: await usdg.getAddress(),
          collateralDecimals: 6,
          stakeEndTimestamp: now + 7 * 24 * 3600,
          resolveAfterTimestamp: now + 8 * 24 * 3600,
          metadataHash: ethers.keccak256(ethers.toUtf8Bytes("fpmm-btc")),
          outcomeLabels: ["Above $100k", "Below $100k"],
          metadataURI: "ipfs://fpmm-btc",
          minInitialFunding: MIN_FUNDING,
          initialFunding: INITIAL_FUNDING,
          fundingHint: [1n, 1n],
          shareRecipient: creator.address,
        },
        priceAssetKey: btcAssetKey(),
        priceThreshold: 100_000n * 10n ** 6n,
        priceKind: 0,
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
      };

      await usdg.connect(creator).approve(await factory.getAddress(), INITIAL_FUNDING);
      const tx = await factory.connect(creator).createPriceMarket(params);
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((p) => p?.name === "MarketCreated");

      marketAddr = created.args.market;
      market = await ethers.getContractAt("ZedkrFpmmMarket", marketAddr);
      const tokens = await factory.getMarketOutcomeTokens(marketAddr);
      const Outcome = await ethers.getContractFactory("ZedkrOutcomeToken");
      outcomeTokens = tokens.map((t) => Outcome.attach(t));
    });

    it("is funded and quotes ~50/50", async function () {
      expect(await market.funded()).to.be.true;
      const p0 = await market.priceOf(0);
      const p1 = await market.priceOf(1);
      expect(p0 + p1).to.equal(10n ** 18n);
      expect(p0).to.be.closeTo(5n * 10n ** 17n, 10n ** 16n);
    });

    it("buy moves price toward bought outcome", async function () {
      await usdg.connect(trader1).approve(marketAddr, TRADE_AMOUNT);
      const pBefore = await market.priceOf(0);
      await market.connect(trader1).buy(0, TRADE_AMOUNT, 0n);
      const pAfter = await market.priceOf(0);
      expect(pAfter).to.be.gt(pBefore);
      expect(await outcomeTokens[0].balanceOf(trader1.address)).to.be.gt(0n);
    });

    it("sell returns collateral", async function () {
      const shares = await outcomeTokens[0].balanceOf(trader1.address);
      const sellAmount = shares / 4n;
      await outcomeTokens[0].connect(trader1).approve(marketAddr, sellAmount);
      const balBefore = await usdg.balanceOf(trader1.address);
      const returnAmount = ethers.parseUnits("5", 6);
      await market.connect(trader1).sell(0, returnAmount, sellAmount);
      expect(await usdg.balanceOf(trader1.address)).to.be.gt(balBefore);
    });

    it("settlePrice picks outcome 0 when BTC above threshold", async function () {
      const resolveAfter = await market.resolveAfterTimestamp();
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(resolveAfter) + 1]);
      await ethers.provider.send("evm_mine");

      await market.settlePrice();
      expect(await market.state()).to.equal(2n);
      expect(await market.winningOutcomeIndex()).to.equal(0n);
      expect(await market.redemptionRate()).to.equal(10n ** 18n);
    });

    it("winner redeems 1 USDG per share", async function () {
      const shares = await outcomeTokens[0].balanceOf(trader1.address);
      await outcomeTokens[0].connect(trader1).approve(marketAddr, shares);
      const balBefore = await usdg.balanceOf(trader1.address);
      await market.connect(trader1).redeem(0, shares);
      expect(await usdg.balanceOf(trader1.address) - balBefore).to.equal(shares);
    });
  });

  describe("EVENT market — 3-of-3 admin resolve", function () {
    let market;
    let marketAddr;
    let outcomeTokens;

    before(async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        collateralToken: await usdg.getAddress(),
        collateralDecimals: 6,
        stakeEndTimestamp: now + 3600,
        resolveAfterTimestamp: now + 7200,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes("fpmm-event")),
        outcomeLabels: ["Team A", "Team B"],
        metadataURI: "ipfs://fpmm-event",
        minInitialFunding: MIN_FUNDING,
        initialFunding: INITIAL_FUNDING,
        fundingHint: [1n, 1n],
        shareRecipient: creator.address,
      };

      await usdg.connect(creator).approve(await factory.getAddress(), INITIAL_FUNDING);
      const tx = await factory.connect(creator).createEventMarket(params);
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((p) => p?.name === "MarketCreated");

      marketAddr = created.args.market;
      market = await ethers.getContractAt("ZedkrFpmmMarket", marketAddr);
      const tokens = await factory.getMarketOutcomeTokens(marketAddr);
      const Outcome = await ethers.getContractFactory("ZedkrOutcomeToken");
      outcomeTokens = tokens.map((t) => Outcome.attach(t));

      await usdg.connect(trader2).approve(marketAddr, TRADE_AMOUNT);
      await market.connect(trader2).buy(1, TRADE_AMOUNT, 0n);
    });

    it("resolveEvent with 3 admin signatures", async function () {
      await ethers.provider.send("evm_increaseTime", [7201]);
      await ethers.provider.send("evm_mine", []);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const sig1 = await signEventResolution(admin1, marketAddr, 1, chainId);
      const sig2 = await signEventResolution(admin2, marketAddr, 1, chainId);
      const sig3 = await signEventResolution(admin3, marketAddr, 1, chainId);

      await market.resolveEvent(1, [admin1.address, admin2.address, admin3.address], [sig1, sig2, sig3]);
      expect(await market.winningOutcomeIndex()).to.equal(1n);

      const shares = await outcomeTokens[1].balanceOf(trader2.address);
      await outcomeTokens[1].connect(trader2).approve(marketAddr, shares);
      const balBefore = await usdg.balanceOf(trader2.address);
      await market.connect(trader2).redeem(1, shares);
      expect(await usdg.balanceOf(trader2.address) - balBefore).to.equal(shares);
    });
  });

  describe("PONS market — bot admin resolve", function () {
    let market;
    let marketAddr;
    let outcomeTokens;

    before(async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        collateralToken: await usdg.getAddress(),
        collateralDecimals: 6,
        stakeEndTimestamp: now + 3600,
        resolveAfterTimestamp: now + 7200,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes("fpmm-pons")),
        outcomeLabels: ["Token A wins", "Token B wins"],
        metadataURI: "ipfs://fpmm-pons",
        minInitialFunding: MIN_FUNDING,
        initialFunding: INITIAL_FUNDING,
        fundingHint: [1n, 1n],
        shareRecipient: creator.address,
      };

      await usdg.connect(creator).approve(await factory.getAddress(), INITIAL_FUNDING);
      const tx = await factory.connect(creator).createPonsMarket(params);
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((p) => p?.name === "MarketCreated");

      marketAddr = created.args.market;
      market = await ethers.getContractAt("ZedkrFpmmMarket", marketAddr);
      const tokens = await factory.getMarketOutcomeTokens(marketAddr);
      const Outcome = await ethers.getContractFactory("ZedkrOutcomeToken");
      outcomeTokens = tokens.map((t) => Outcome.attach(t));
    });

    it("only ponsResolutionAdmin can resolve", async function () {
      await ethers.provider.send("evm_increaseTime", [7201]);
      await ethers.provider.send("evm_mine", []);

      await expect(market.connect(creator).resolvePonsToken(0)).to.be.revertedWithCustomError(
        market,
        "NotPonsResolutionAdmin"
      );
      await market.connect(trader1).resolvePonsToken(0);
      expect(await market.state()).to.equal(2n);
      expect(await market.winningOutcomeIndex()).to.equal(0n);
    });
  });

  describe("FPMM vs parimutuel — fixed $1 payout per share", function () {
    it("trade fees match Zedkr split (0.6% creator + 0.4% protocol)", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const feed = await deployMockFeed(owner, 50_000n * 10n ** 8n, 8);
      await factory.connect(owner).setPriceFeed(btcAssetKey(), await feed.getAddress());

      const params = {
        base: {
          collateralToken: await usdg.getAddress(),
          collateralDecimals: 6,
          stakeEndTimestamp: now + 3600,
          resolveAfterTimestamp: now + 7200,
          metadataHash: ethers.keccak256(ethers.toUtf8Bytes("fee-check")),
          outcomeLabels: ["Yes", "No"],
          metadataURI: "ipfs://fee",
          minInitialFunding: MIN_FUNDING,
          initialFunding: INITIAL_FUNDING,
          fundingHint: [1n, 1n],
          shareRecipient: creator.address,
        },
        priceAssetKey: btcAssetKey(),
        priceThreshold: 100_000n * 10n ** 6n,
        priceKind: 0,
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
      };

      await usdg.connect(creator).approve(await factory.getAddress(), INITIAL_FUNDING);
      const tx = await factory.connect(creator).createPriceMarket(params);
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((p) => p?.name === "MarketCreated");

      const marketAddr = created.args.market;
      const market = await ethers.getContractAt("ZedkrFpmmMarket", marketAddr);

      const creatorBefore = await usdg.balanceOf(creator.address);
      const feeBefore = await usdg.balanceOf(feeRecipient.address);
      await usdg.connect(trader2).approve(marketAddr, TRADE_AMOUNT);
      await market.connect(trader2).buy(0, TRADE_AMOUNT, 0n);

      expect(await usdg.balanceOf(creator.address) - creatorBefore).to.equal(bps(TRADE_AMOUNT, CREATOR_FEE_BPS));
      expect(await usdg.balanceOf(feeRecipient.address) - feeBefore).to.equal(bps(TRADE_AMOUNT, PROTOCOL_FEE_BPS));
    });
  });

  describe("Negative create guards", function () {
    it("rejects stake end in the past", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        base: {
          collateralToken: await usdg.getAddress(),
          collateralDecimals: 6,
          stakeEndTimestamp: now - 10,
          resolveAfterTimestamp: now + 3600,
          metadataHash: ethers.keccak256(ethers.toUtf8Bytes("https://zedkr.market/ipfs/past-stake")),
          outcomeLabels: ["Yes", "No"],
          metadataURI: "https://gateway.lighthouse.storage/ipfs/bafy-past-stake-test",
          minInitialFunding: MIN_FUNDING,
          initialFunding: INITIAL_FUNDING,
          fundingHint: [1n, 1n],
          shareRecipient: creator.address,
        },
        priceAssetKey: btcAssetKey(),
        priceThreshold: 100_000n * 10n ** 6n,
        priceKind: 0,
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
      };
      await usdg.connect(creator).approve(await factory.getAddress(), INITIAL_FUNDING);
      await expect(factory.connect(creator).createPriceMarket(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidTime",
      );
    });

    it("rejects unregistered Chainlink asset key", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        base: {
          collateralToken: await usdg.getAddress(),
          collateralDecimals: 6,
          stakeEndTimestamp: now + 3600,
          resolveAfterTimestamp: now + 7200,
          metadataHash: ethers.keccak256(ethers.toUtf8Bytes("https://zedkr.market/ipfs/no-feed")),
          outcomeLabels: ["Yes", "No"],
          metadataURI: "ipfs://bafy-no-feed-key",
          minInitialFunding: MIN_FUNDING,
          initialFunding: INITIAL_FUNDING,
          fundingHint: [1n, 1n],
          shareRecipient: creator.address,
        },
        priceAssetKey: ethers.keccak256(ethers.toUtf8Bytes("DOGE")),
        priceThreshold: 1n,
        priceKind: 0,
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
      };
      await usdg.connect(creator).approve(await factory.getAddress(), INITIAL_FUNDING);
      await expect(factory.connect(creator).createPriceMarket(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidFeed",
      );
    });

    it("rejects seed below minInitialFunding", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        collateralToken: await usdg.getAddress(),
        collateralDecimals: 6,
        stakeEndTimestamp: now + 3600,
        resolveAfterTimestamp: now + 7200,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes("ipfs://underseed")),
        outcomeLabels: ["A", "B"],
        metadataURI: "ipfs://bafy-underseed-event",
        minInitialFunding: MIN_FUNDING,
        initialFunding: MIN_FUNDING / 2n,
        fundingHint: [1n, 1n],
        shareRecipient: creator.address,
      };
      await usdg.connect(creator).approve(await factory.getAddress(), MIN_FUNDING);
      await expect(factory.connect(creator).createEventMarket(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidFunding",
      );
    });

    it("persists metadataURI on-chain after create", async function () {
      const uri = "https://gateway.lighthouse.storage/ipfs/bafy-zedkr-fpmm-metadata-test";
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const feed = await deployMockFeed(owner, 50_000n * 10n ** 8n, 8);
      await factory.connect(owner).setPriceFeed(btcAssetKey(), await feed.getAddress());

      const params = {
        base: {
          collateralToken: await usdg.getAddress(),
          collateralDecimals: 6,
          stakeEndTimestamp: now + 3600,
          resolveAfterTimestamp: now + 7200,
          metadataHash: ethers.keccak256(ethers.toUtf8Bytes(uri)),
          outcomeLabels: ["Yes", "No"],
          metadataURI: uri,
          minInitialFunding: MIN_FUNDING,
          initialFunding: INITIAL_FUNDING,
          fundingHint: [1n, 1n],
          shareRecipient: creator.address,
        },
        priceAssetKey: btcAssetKey(),
        priceThreshold: 100_000n * 10n ** 6n,
        priceKind: 0,
        priceUpperBound: 0n,
        maxPriceStaleness: 3600n,
        priceBinLower: [],
        priceBinUpper: [],
      };

      await usdg.connect(creator).approve(await factory.getAddress(), INITIAL_FUNDING);
      const tx = await factory.connect(creator).createPriceMarket(params);
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((p) => p?.name === "MarketCreated");

      const market = await ethers.getContractAt("ZedkrFpmmMarket", created.args.market);
      expect(await market.metadataURI()).to.equal(uri);
      expect(await market.metadataHash()).to.equal(params.base.metadataHash);
    });
  });
});

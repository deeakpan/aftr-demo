/**
 * Chainlink Data Feeds on Robinhood Chain mainnet (4663).
 * Source: https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json
 * (mirrors https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood)
 *
 * Curated majors only — add entries here when Chainlink publishes new feeds.
 * Factory owner registers via setPriceFeed(assetKey, feed) or scripts/set-price-feeds.cjs.
 */
const ROBINHOOD_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const ROBINHOOD_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/** Robinhood stock-token ERC-20s (for Pons pair USD lookup). */
const STOCK_TOKENS = {
  AAPL: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  GOOGL: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
  MSFT: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
  AMZN: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
  META: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
  NVDA: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
  TSLA: "0x322f0929c4625ed5bad873c95208d54e1c003b2d",
  SPY: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
  QQQ: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
  AMD: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
  COIN: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
  MSTR: "0xec262a75e413fAfD0dF80480274532C79D42da09",
};

const CRYPTO_LOGOS = {
  BTC: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  ETH: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  LINK: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  USDG: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
};

function stockFeed(asset, address, tokenAddress) {
  return {
    label: `${asset}/USD`,
    asset,
    address,
    decimals: 8,
    ...(tokenAddress ? { tokenAddress } : {}),
  };
}

function cryptoFeed(asset, address) {
  return {
    label: `${asset}/USD`,
    asset,
    logo: CRYPTO_LOGOS[asset],
    address,
    decimals: 8,
  };
}

function robinhoodChainlinkFeedsForDeployment() {
  return [
    cryptoFeed("BTC", "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251"),
    cryptoFeed("ETH", "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9"),
    cryptoFeed("LINK", "0xe86e3422Aa9B5e8ee9f3E41a63975bC387A8bce9"),
    {
      label: "USDG/USD",
      asset: "USDG",
      logo: CRYPTO_LOGOS.USDG,
      address: "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2",
      decimals: 8,
      tokenAddress: ROBINHOOD_USDG,
    },
    stockFeed("AAPL", "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", STOCK_TOKENS.AAPL),
    stockFeed("GOOGL", "0xF6f373a037c30F0e5010d854385cA89185AE638b", STOCK_TOKENS.GOOGL),
    stockFeed("MSFT", "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", STOCK_TOKENS.MSFT),
    stockFeed("AMZN", "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", STOCK_TOKENS.AMZN),
    stockFeed("META", "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", STOCK_TOKENS.META),
    stockFeed("NVDA", "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", STOCK_TOKENS.NVDA),
    stockFeed("TSLA", "0x4A1166a659A55625345e9515b32adECea5547C38", STOCK_TOKENS.TSLA),
    stockFeed("SPY", "0x319724394D3A0e3669269846abE664Cd621f9f6A", STOCK_TOKENS.SPY),
    stockFeed("QQQ", "0x80901d846d5D7B030F26B480776EE3b29374C2ae", STOCK_TOKENS.QQQ),
    stockFeed("AMD", "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72", STOCK_TOKENS.AMD),
    stockFeed("COIN", "0xA3a468A452940B7D6b69991207B508c609a98Ef2", STOCK_TOKENS.COIN),
    stockFeed("MSTR", "0x396118bdFB181e6240E74D243F266B061c0edc3D", STOCK_TOKENS.MSTR),
  ];
}

/** Assets shown in Create → Price market dropdown (excludes stablecoin quote feeds). */
function robinhoodPriceFeedAssets() {
  return robinhoodChainlinkFeedsForDeployment()
    .filter((f) => f.asset !== "USDG")
    .map(({ label, asset, logo }) => ({ label, asset, ...(logo ? { logo } : {}) }));
}

function robinhoodNetworkExternals() {
  return {
    oo: process.env.UMA_OOV2?.trim() || "0x0000000000000000000000000000000000000001",
    circleUsdc: null,
    weth: ROBINHOOD_WETH,
    usdg: ROBINHOOD_USDG,
    deployLocalWeth: false,
    registerCircleUsdc: false,
    ethFeed: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9",
    chainlinkFeeds: robinhoodChainlinkFeedsForDeployment(),
    priceFeedAssets: robinhoodPriceFeedAssets(),
    vaultCollateralOptions: [
      { label: "WETH", address: ROBINHOOD_WETH },
      { label: "USDG", address: ROBINHOOD_USDG },
    ],
    pons: {
      v2LaunchFactory: process.env.PONS_V2_FACTORY?.trim() || "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
      v1LaunchFactory: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
      weth: ROBINHOOD_WETH,
      usdg: ROBINHOOD_USDG,
    },
  };
}

module.exports = {
  ROBINHOOD_WETH,
  ROBINHOOD_USDG,
  STOCK_TOKENS,
  robinhoodChainlinkFeedsForDeployment,
  robinhoodPriceFeedAssets,
  robinhoodNetworkExternals,
};

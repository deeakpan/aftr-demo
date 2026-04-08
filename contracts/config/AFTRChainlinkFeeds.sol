// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AFTRChainlinkFeeds
/// @notice Feed keys + aggregator addresses for Base (initial set from team).
library AFTRChainlinkFeeds {
    bytes32 internal constant BTC_USD = keccak256("BTC/USD");
    bytes32 internal constant CBETH_ETH = keccak256("CBETH/ETH");
    bytes32 internal constant CBETH_USD = keccak256("CBETH/USD");
    bytes32 internal constant DAI_USD = keccak256("DAI/USD");
    bytes32 internal constant ETH_USD = keccak256("ETH/USD");
    bytes32 internal constant LINK_ETH = keccak256("LINK/ETH");
    bytes32 internal constant LINK_USD = keccak256("LINK/USD");
    bytes32 internal constant USDC_USD = keccak256("USDC/USD");

    address internal constant BTC_USD_FEED = 0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298;
    address internal constant CBETH_ETH_FEED = 0x91b21900E91CD302EBeD05E45D8f270ddAED944d;
    address internal constant CBETH_USD_FEED = 0x3c65e28D357a37589e1C7C86044a9f44dDC17134;
    address internal constant DAI_USD_FEED = 0xD1092a65338d049DB68D7Be6bD89d17a0929945e;
    address internal constant ETH_USD_FEED = 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1;
    address internal constant LINK_ETH_FEED = 0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69;
    address internal constant LINK_USD_FEED = 0xb113F5A928BCfF189C998ab20d753a47F9dE5A61;
    address internal constant USDC_USD_FEED = 0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165;
}

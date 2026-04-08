// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../token/AFTROutcomeToken.sol";
import "../core/AFTRVParimutuelMarket.sol";

/// @title AFTRParimutuelDeployer
/// @notice Deploys outcome tokens + market for AFTRParimutuelMarketFactory (keeps factory bytecode small).
contract AFTRParimutuelDeployer {
    address public immutable factory;

    error OnlyFactory();
    error EmptyLabel();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(address factory_) {
        factory = factory_;
    }

    function deployPriceMarket(
        address owner_,
        address feeRecipient_,
        address collateralToken_,
        uint8 collateralDecimals_,
        uint8 numOutcomes_,
        uint256 virtualReserve_,
        uint256 stakeEndTimestamp_,
        uint256 resolveAfterTimestamp_,
        bytes32 metadataHash_,
        address chainlinkFeed_,
        uint256 priceThreshold_,
        AFTRVParimutuelMarket.PriceThresholdKind priceKind_,
        uint256 priceUpperBound_,
        uint256 maxPriceStaleness_,
        uint256 minBootstrapTotal_,
        string[] calldata outcomeLabels
    ) external onlyFactory returns (address market, address[] memory tokens) {
        tokens = _deployOutcomeTokens(outcomeLabels, collateralDecimals_);
        AFTRVParimutuelMarket mkt = new AFTRVParimutuelMarket(
            factory,
            owner_,
            feeRecipient_,
            collateralToken_,
            collateralDecimals_,
            numOutcomes_,
            virtualReserve_,
            stakeEndTimestamp_,
            resolveAfterTimestamp_,
            AFTRVParimutuelMarket.MarketKind.PRICE,
            metadataHash_,
            chainlinkFeed_,
            priceThreshold_,
            priceKind_,
            priceUpperBound_,
            maxPriceStaleness_,
            address(0),
            bytes32(0),
            0,
            0,
            0,
            address(0),
            minBootstrapTotal_
        );
        market = address(mkt);
    }

    function deployEventMarket(
        address owner_,
        address feeRecipient_,
        address collateralToken_,
        uint8 collateralDecimals_,
        uint8 numOutcomes_,
        uint256 virtualReserve_,
        uint256 stakeEndTimestamp_,
        uint256 resolveAfterTimestamp_,
        bytes32 metadataHash_,
        address optimisticOracleV2_,
        bytes32 umaIdentifier_,
        uint64 umaLiveness_,
        uint256 umaProposerBond_,
        uint256 umaReward_,
        address bondToken_,
        uint256 minBootstrapTotal_,
        string[] calldata outcomeLabels
    ) external onlyFactory returns (address market, address[] memory tokens) {
        tokens = _deployOutcomeTokens(outcomeLabels, collateralDecimals_);
        AFTRVParimutuelMarket mkt = new AFTRVParimutuelMarket(
            factory,
            owner_,
            feeRecipient_,
            collateralToken_,
            collateralDecimals_,
            numOutcomes_,
            virtualReserve_,
            stakeEndTimestamp_,
            resolveAfterTimestamp_,
            AFTRVParimutuelMarket.MarketKind.EVENT,
            metadataHash_,
            address(0),
            0,
            AFTRVParimutuelMarket.PriceThresholdKind.ABOVE,
            0,
            0,
            optimisticOracleV2_,
            umaIdentifier_,
            umaLiveness_,
            umaProposerBond_,
            umaReward_,
            bondToken_,
            minBootstrapTotal_
        );
        market = address(mkt);
    }

    function _deployOutcomeTokens(string[] calldata labels, uint8 decimals_)
        internal
        returns (address[] memory tokens)
    {
        uint256 n = labels.length;
        tokens = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            if (bytes(labels[i]).length == 0) revert EmptyLabel();
            tokens[i] = address(new AFTROutcomeToken(labels[i], "OUT", decimals_, factory));
        }
    }
}

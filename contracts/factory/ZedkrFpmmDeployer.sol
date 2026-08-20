// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../token/ZedkrOutcomeToken.sol";
import "../core/ZedkrFpmmMarket.sol";

/// @title ZedkrFpmmDeployer
/// @notice Deploys Zedkr outcome tokens + FPMM market clones.
contract ZedkrFpmmDeployer {
    address public immutable factory;

    error EmptyLabel();
    error OnlyFactory();

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
        address creator_,
        address collateralToken_,
        uint8 collateralDecimals_,
        uint8 numOutcomes_,
        uint256 stakeEndTimestamp_,
        uint256 resolveAfterTimestamp_,
        bytes32 metadataHash_,
        address chainlinkFeed_,
        uint256 priceThreshold_,
        ZedkrFpmmMarket.PriceThresholdKind priceKind_,
        uint256 priceUpperBound_,
        uint256 maxPriceStaleness_,
        uint256 minInitialFunding_,
        string[] calldata outcomeLabels
    ) external onlyFactory returns (address market, address[] memory tokens) {
        tokens = _deployOutcomeTokens(outcomeLabels, collateralDecimals_);
        ZedkrFpmmMarket mkt = new ZedkrFpmmMarket(
            factory,
            owner_,
            feeRecipient_,
            creator_,
            collateralToken_,
            collateralDecimals_,
            numOutcomes_,
            stakeEndTimestamp_,
            resolveAfterTimestamp_,
            ZedkrFpmmMarket.MarketKind.PRICE,
            metadataHash_,
            chainlinkFeed_,
            priceThreshold_,
            priceKind_,
            priceUpperBound_,
            maxPriceStaleness_,
            minInitialFunding_
        );
        market = address(mkt);
    }

    function deployEventMarket(
        address owner_,
        address feeRecipient_,
        address creator_,
        address collateralToken_,
        uint8 collateralDecimals_,
        uint8 numOutcomes_,
        uint256 stakeEndTimestamp_,
        uint256 resolveAfterTimestamp_,
        bytes32 metadataHash_,
        uint256 minInitialFunding_,
        string[] calldata outcomeLabels
    ) external onlyFactory returns (address market, address[] memory tokens) {
        return _deployResolutionMarket(
            ZedkrFpmmMarket.MarketKind.EVENT,
            owner_,
            feeRecipient_,
            creator_,
            collateralToken_,
            collateralDecimals_,
            numOutcomes_,
            stakeEndTimestamp_,
            resolveAfterTimestamp_,
            metadataHash_,
            minInitialFunding_,
            outcomeLabels
        );
    }

    function deployPonsMarket(
        address owner_,
        address feeRecipient_,
        address creator_,
        address collateralToken_,
        uint8 collateralDecimals_,
        uint8 numOutcomes_,
        uint256 stakeEndTimestamp_,
        uint256 resolveAfterTimestamp_,
        bytes32 metadataHash_,
        uint256 minInitialFunding_,
        string[] calldata outcomeLabels
    ) external onlyFactory returns (address market, address[] memory tokens) {
        return _deployResolutionMarket(
            ZedkrFpmmMarket.MarketKind.PONS_TOKEN,
            owner_,
            feeRecipient_,
            creator_,
            collateralToken_,
            collateralDecimals_,
            numOutcomes_,
            stakeEndTimestamp_,
            resolveAfterTimestamp_,
            metadataHash_,
            minInitialFunding_,
            outcomeLabels
        );
    }

    function _deployResolutionMarket(
        ZedkrFpmmMarket.MarketKind kind,
        address owner_,
        address feeRecipient_,
        address creator_,
        address collateralToken_,
        uint8 collateralDecimals_,
        uint8 numOutcomes_,
        uint256 stakeEndTimestamp_,
        uint256 resolveAfterTimestamp_,
        bytes32 metadataHash_,
        uint256 minInitialFunding_,
        string[] calldata outcomeLabels
    ) internal returns (address market, address[] memory tokens) {
        tokens = _deployOutcomeTokens(outcomeLabels, collateralDecimals_);
        ZedkrFpmmMarket mkt = new ZedkrFpmmMarket(
            factory,
            owner_,
            feeRecipient_,
            creator_,
            collateralToken_,
            collateralDecimals_,
            numOutcomes_,
            stakeEndTimestamp_,
            resolveAfterTimestamp_,
            kind,
            metadataHash_,
            address(0),
            0,
            ZedkrFpmmMarket.PriceThresholdKind.ABOVE,
            0,
            0,
            minInitialFunding_
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
            tokens[i] = address(new ZedkrOutcomeToken(labels[i], "ZOUT", decimals_, factory));
        }
    }
}

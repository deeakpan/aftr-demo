// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./AFTRParimutuelMarketFactory.sol";

/// @title AFTRParimutuelBatchFactory
/// @notice Batch helper that calls the core AFTR factory repeatedly for multi-collateral deployments.
/// @dev Set this contract as `batchExecutor` in AFTRParimutuelMarketFactory before use.
contract AFTRParimutuelBatchFactory is Ownable2Step {
    AFTRParimutuelMarketFactory public immutable coreFactory;

    constructor(address owner_, address coreFactory_) Ownable(owner_) {
        require(coreFactory_ != address(0), "Factory");
        coreFactory = AFTRParimutuelMarketFactory(coreFactory_);
    }

    function createPriceMarketsBatch(
        AFTRParimutuelMarketFactory.PriceMarketParams calldata templateParams,
        address[] calldata collateralTokens
    ) external onlyOwner returns (address[] memory deployed) {
        deployed = new address[](collateralTokens.length);
        for (uint256 i = 0; i < collateralTokens.length; i++) {
            AFTRParimutuelMarketFactory.PriceMarketParams memory p = _copyPrice(templateParams);
            p.collateralToken = collateralTokens[i];
            p.collateralDecimals = collateralTokens[i] == address(0) ? 18 : templateParams.collateralDecimals;
            deployed[i] = coreFactory.createPriceMarket(p);
        }
    }

    function createEventMarketsBatch(
        AFTRParimutuelMarketFactory.EventMarketParams calldata templateParams,
        address[] calldata collateralTokens
    ) external onlyOwner returns (address[] memory deployed) {
        deployed = new address[](collateralTokens.length);
        for (uint256 i = 0; i < collateralTokens.length; i++) {
            AFTRParimutuelMarketFactory.EventMarketParams memory p = _copyEvent(templateParams);
            p.collateralToken = collateralTokens[i];
            p.collateralDecimals = collateralTokens[i] == address(0) ? 18 : templateParams.collateralDecimals;
            deployed[i] = coreFactory.createEventMarket(p);
        }
    }

    function _copyPrice(AFTRParimutuelMarketFactory.PriceMarketParams calldata p)
        internal
        pure
        returns (AFTRParimutuelMarketFactory.PriceMarketParams memory q)
    {
        q.collateralToken = p.collateralToken;
        q.collateralDecimals = p.collateralDecimals;
        q.virtualReserve = p.virtualReserve;
        q.stakeEndTimestamp = p.stakeEndTimestamp;
        q.resolveAfterTimestamp = p.resolveAfterTimestamp;
        q.metadataHash = p.metadataHash;
        q.outcomeLabels = p.outcomeLabels;
        q.chainlinkFeed = p.chainlinkFeed;
        q.priceThreshold = p.priceThreshold;
        q.priceKind = p.priceKind;
        q.priceUpperBound = p.priceUpperBound;
        q.maxPriceStaleness = p.maxPriceStaleness;
        q.priceBinLower = p.priceBinLower;
        q.priceBinUpper = p.priceBinUpper;
        q.minBootstrapTotal = p.minBootstrapTotal;
    }

    function _copyEvent(AFTRParimutuelMarketFactory.EventMarketParams calldata p)
        internal
        pure
        returns (AFTRParimutuelMarketFactory.EventMarketParams memory q)
    {
        q.collateralToken = p.collateralToken;
        q.collateralDecimals = p.collateralDecimals;
        q.virtualReserve = p.virtualReserve;
        q.stakeEndTimestamp = p.stakeEndTimestamp;
        q.resolveAfterTimestamp = p.resolveAfterTimestamp;
        q.metadataHash = p.metadataHash;
        q.outcomeLabels = p.outcomeLabels;
        q.metadataURI = p.metadataURI;
        q.umaAncillary = p.umaAncillary;
        q.umaIdentifier = p.umaIdentifier;
        q.umaLiveness = p.umaLiveness;
        q.umaProposerBond = p.umaProposerBond;
        q.umaReward = p.umaReward;
        q.umaRewardCurrency = p.umaRewardCurrency;
        q.minBootstrapTotal = p.minBootstrapTotal;
    }
}

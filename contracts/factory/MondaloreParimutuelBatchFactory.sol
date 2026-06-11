// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MondaloreParimutuelMarketFactory.sol";

/// @title MondaloreParimutuelBatchFactory
/// @notice Batch helper that calls the core Mondalore factory repeatedly for multi-collateral deployments.
/// @dev Only supports ERC20 collateral markets (not native ETH) due to per-market bootstrap amounts.
///      Caller must pre-approve this contract for sum(bootstrapAmount) across all collateral tokens.
contract MondaloreParimutuelBatchFactory is Ownable2Step {
    using SafeERC20 for IERC20;

    MondaloreParimutuelMarketFactory public immutable coreFactory;

    constructor(address owner_, address coreFactory_) Ownable(owner_) {
        require(coreFactory_ != address(0), "Factory");
        coreFactory = MondaloreParimutuelMarketFactory(coreFactory_);
    }

    /// @notice Deploy multiple price markets, one per collateral token.
    /// @dev Caller must pre-approve this contract for `templateParams.bootstrapAmount` per collateral token.
    ///      All markets share the same bootstrapAmount and shareRecipient from the template.
    function createPriceMarketsBatch(
        MondaloreParimutuelMarketFactory.PriceMarketParams calldata templateParams,
        address[] calldata collateralTokens
    ) external onlyOwner returns (address[] memory deployed) {
        require(templateParams.collateralToken == address(0) || true, ""); // silence unused warning
        deployed = new address[](collateralTokens.length);
        for (uint256 i = 0; i < collateralTokens.length; i++) {
            address token = collateralTokens[i];
            require(token != address(0), "ETH not supported in batch");

            MondaloreParimutuelMarketFactory.PriceMarketParams memory p = _copyPrice(templateParams);
            p.collateralToken = token;
            p.collateralDecimals = templateParams.collateralDecimals;

            // Pull bootstrap collateral from caller and approve factory.
            IERC20(token).safeTransferFrom(msg.sender, address(this), p.bootstrapAmount);
            IERC20(token).forceApprove(address(coreFactory), p.bootstrapAmount);

            deployed[i] = coreFactory.createPriceMarket(p);
        }
    }

    /// @notice Deploy multiple event markets, one per collateral token.
    /// @dev Caller must pre-approve this contract for `templateParams.bootstrapAmount` per collateral token.
    function createEventMarketsBatch(
        MondaloreParimutuelMarketFactory.EventMarketParams calldata templateParams,
        address[] calldata collateralTokens
    ) external onlyOwner returns (address[] memory deployed) {
        deployed = new address[](collateralTokens.length);
        for (uint256 i = 0; i < collateralTokens.length; i++) {
            address token = collateralTokens[i];
            require(token != address(0), "ETH not supported in batch");

            MondaloreParimutuelMarketFactory.EventMarketParams memory p = _copyEvent(templateParams);
            p.collateralToken = token;
            p.collateralDecimals = templateParams.collateralDecimals;

            // Pull bootstrap collateral from caller and approve factory.
            IERC20(token).safeTransferFrom(msg.sender, address(this), p.bootstrapAmount);
            IERC20(token).forceApprove(address(coreFactory), p.bootstrapAmount);

            deployed[i] = coreFactory.createEventMarket(p);
        }
    }

    function _copyPrice(MondaloreParimutuelMarketFactory.PriceMarketParams calldata p)
        internal
        pure
        returns (MondaloreParimutuelMarketFactory.PriceMarketParams memory q)
    {
        q.collateralToken = p.collateralToken;
        q.collateralDecimals = p.collateralDecimals;
        q.virtualReserve = p.virtualReserve;
        q.stakeEndTimestamp = p.stakeEndTimestamp;
        q.resolveAfterTimestamp = p.resolveAfterTimestamp;
        q.metadataHash = p.metadataHash;
        q.outcomeLabels = p.outcomeLabels;
        q.metadataURI = p.metadataURI;
        q.priceAssetKey = p.priceAssetKey;
        q.priceThreshold = p.priceThreshold;
        q.priceKind = p.priceKind;
        q.priceUpperBound = p.priceUpperBound;
        q.maxPriceStaleness = p.maxPriceStaleness;
        q.priceBinLower = p.priceBinLower;
        q.priceBinUpper = p.priceBinUpper;
        q.minBootstrapTotal = p.minBootstrapTotal;
        q.bootstrapAmount = p.bootstrapAmount;
        q.shareRecipient = p.shareRecipient;
    }

    function _copyEvent(MondaloreParimutuelMarketFactory.EventMarketParams calldata p)
        internal
        pure
        returns (MondaloreParimutuelMarketFactory.EventMarketParams memory q)
    {
        q.collateralToken = p.collateralToken;
        q.collateralDecimals = p.collateralDecimals;
        q.virtualReserve = p.virtualReserve;
        q.stakeEndTimestamp = p.stakeEndTimestamp;
        q.resolveAfterTimestamp = p.resolveAfterTimestamp;
        q.metadataHash = p.metadataHash;
        q.outcomeLabels = p.outcomeLabels;
        q.metadataURI = p.metadataURI;
        q.minBootstrapTotal = p.minBootstrapTotal;
        q.bootstrapAmount = p.bootstrapAmount;
        q.shareRecipient = p.shareRecipient;
    }
}

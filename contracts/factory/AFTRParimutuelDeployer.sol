// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../token/AFTROutcomeToken.sol";
import "../core/AFTRVParimutuelMarket.sol";

// ─── Price sub-deployer ───────────────────────────────────────────────────────

/// @title AFTRPriceMarketDeployer
/// @notice Deploys outcome tokens + PRICE market. Split from event deployer to stay under 24KB.
contract AFTRPriceMarketDeployer {
    address public immutable facade;
    address public immutable factory;

    error OnlyFacade();
    error EmptyLabel();

    modifier onlyFacade() {
        if (msg.sender != facade) revert OnlyFacade();
        _;
    }

    constructor(address facade_, address factory_) {
        facade  = facade_;
        factory = factory_;
    }

    function deployPriceMarket(
        address owner_,
        address feeRecipient_,
        address creator_,
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
    ) external onlyFacade returns (address market, address[] memory tokens) {
        tokens = _deployOutcomeTokens(outcomeLabels, collateralDecimals_);
        AFTRVParimutuelMarket mkt = new AFTRVParimutuelMarket(
            factory,
            owner_,
            feeRecipient_,
            creator_,
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

// ─── Event sub-deployer ───────────────────────────────────────────────────────

/// @title AFTREventMarketDeployer
/// @notice Deploys outcome tokens + EVENT market. Split from price deployer to stay under 24KB.
contract AFTREventMarketDeployer {
    address public immutable facade;
    address public immutable factory;

    error OnlyFacade();
    error EmptyLabel();

    modifier onlyFacade() {
        if (msg.sender != facade) revert OnlyFacade();
        _;
    }

    constructor(address facade_, address factory_) {
        facade  = facade_;
        factory = factory_;
    }

    function deployEventMarket(
        address owner_,
        address feeRecipient_,
        address creator_,
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
    ) external onlyFacade returns (address market, address[] memory tokens) {
        tokens = _deployOutcomeTokens(outcomeLabels, collateralDecimals_);
        AFTRVParimutuelMarket mkt = new AFTRVParimutuelMarket(
            factory,
            owner_,
            feeRecipient_,
            creator_,
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

// ─── Facade ───────────────────────────────────────────────────────────────────

/// @title AFTRParimutuelDeployer
/// @notice Thin facade — factory calls this; it delegates to typed sub-deployers.
///         Deploying sub-deployers in the constructor keeps this contract small.
contract AFTRParimutuelDeployer {
    address public immutable factory;
    AFTRPriceMarketDeployer public immutable priceDeployer;
    AFTREventMarketDeployer public immutable eventDeployer;

    error OnlyFactory();
    error ZeroAddress();
    error InvalidPriceDeployer();
    error InvalidEventDeployer();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    /// @param factory_ Address of AFTRParimutuelMarketFactory.
    /// @param priceDeployer_ Pre-deployed AFTRPriceMarketDeployer with facade == address(this) (use CREATE address prediction).
    /// @param eventDeployer_ Pre-deployed AFTREventMarketDeployer with facade == address(this).
    /// @dev Sub-deployers are deployed in separate txs so facade initcode stays under EIP-3860 limit.
    constructor(address factory_, address priceDeployer_, address eventDeployer_) {
        if (factory_ == address(0) || priceDeployer_ == address(0) || eventDeployer_ == address(0)) {
            revert ZeroAddress();
        }
        factory = factory_;
        AFTRPriceMarketDeployer p = AFTRPriceMarketDeployer(priceDeployer_);
        AFTREventMarketDeployer e = AFTREventMarketDeployer(eventDeployer_);
        if (p.facade() != address(this) || p.factory() != factory_) revert InvalidPriceDeployer();
        if (e.facade() != address(this) || e.factory() != factory_) revert InvalidEventDeployer();
        priceDeployer = p;
        eventDeployer = e;
    }

    function deployPriceMarket(
        address owner_,
        address feeRecipient_,
        address creator_,
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
        return priceDeployer.deployPriceMarket(
            owner_, feeRecipient_, creator_, collateralToken_, collateralDecimals_,
            numOutcomes_, virtualReserve_, stakeEndTimestamp_, resolveAfterTimestamp_,
            metadataHash_, chainlinkFeed_, priceThreshold_, priceKind_, priceUpperBound_,
            maxPriceStaleness_, minBootstrapTotal_, outcomeLabels
        );
    }

    function deployEventMarket(
        address owner_,
        address feeRecipient_,
        address creator_,
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
        return eventDeployer.deployEventMarket(
            owner_, feeRecipient_, creator_, collateralToken_, collateralDecimals_,
            numOutcomes_, virtualReserve_, stakeEndTimestamp_, resolveAfterTimestamp_,
            metadataHash_, optimisticOracleV2_, umaIdentifier_, umaLiveness_,
            umaProposerBond_, umaReward_, bondToken_, minBootstrapTotal_, outcomeLabels
        );
    }
}

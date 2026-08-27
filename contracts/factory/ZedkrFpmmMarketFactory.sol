// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../core/ZedkrFpmmMarket.sol";
import "../registry/ZedkrCollateralRegistry.sol";
import "../token/ZedkrOutcomeToken.sol";
import "./ZedkrFpmmDeployer.sol";

/// @title ZedkrFpmmMarketFactory
/// @notice Creates Zedkr FPMM markets (PRICE / EVENT / PONS) with whitelisted collateral via registry.
contract ZedkrFpmmMarketFactory is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_RESOLUTION_ADMINS = 10;
    uint256 public constant RESOLUTION_THRESHOLD = 3;

    ZedkrCollateralRegistry public immutable collateralRegistry;
    address public feeRecipient;
    address public marketDeployer;
    address public ponsResolutionAdmin;
    // `ponsResolutionAdmin` public getter satisfies IMondaloreMarketFactoryResolution.

    mapping(address => bool) public isResolutionAdmin;
    address[] public resolutionAdmins;
    mapping(bytes32 => address) public priceFeeds;

    address[] public markets;
    mapping(address => bool) public isMarket;
    mapping(address => address[]) private _marketOutcomeTokens;

    event FeeRecipientUpdated(address indexed recipient);
    event MarketDeployerUpdated(address indexed deployer);
    event PonsResolutionAdminUpdated(address indexed admin);
    event PriceFeedUpdated(bytes32 indexed assetKey, address feed);
    event MarketCreated(
        address indexed market,
        ZedkrFpmmMarket.MarketKind indexed kind,
        address indexed collateralToken,
        address[] outcomeTokens,
        string[] outcomeLabels,
        uint256 stakeEndTimestamp,
        uint256 resolveAfterTimestamp,
        bytes32 metadataHash,
        address creator
    );

    error InvalidAddress();
    error InvalidCollateral();
    error InvalidConfig();
    error InvalidOutcomes();
    error InvalidFeed();
    error InvalidTime();
    error InvalidMeta();
    error InvalidBins();
    error InvalidDeployer();
    error InvalidFunding();
    error TooManyResolutionAdmins();
    error InvalidResolutionAdmin();

    constructor(address owner_, address feeRecipient_, ZedkrCollateralRegistry registry_) Ownable(owner_) {
        if (feeRecipient_ == address(0) || address(registry_) == address(0)) revert InvalidAddress();
        feeRecipient = feeRecipient_;
        collateralRegistry = registry_;
    }

    function setFeeRecipient(address r) external onlyOwner {
        if (r == address(0)) revert InvalidAddress();
        feeRecipient = r;
        emit FeeRecipientUpdated(r);
    }

    function setMarketDeployer(address d) external onlyOwner {
        if (d == address(0)) revert InvalidAddress();
        marketDeployer = d;
        emit MarketDeployerUpdated(d);
    }

    function setPonsResolutionAdmin(address admin) external onlyOwner {
        if (admin == address(0)) revert InvalidAddress();
        ponsResolutionAdmin = admin;
        emit PonsResolutionAdminUpdated(admin);
    }

    function nadResolutionAdmin() external view returns (address) {
        return ponsResolutionAdmin;
    }

    function setResolutionAdmins(address[] calldata admins) external onlyOwner {
        if (admins.length > MAX_RESOLUTION_ADMINS) revert TooManyResolutionAdmins();
        for (uint256 i = 0; i < resolutionAdmins.length; i++) {
            isResolutionAdmin[resolutionAdmins[i]] = false;
        }
        delete resolutionAdmins;
        for (uint256 i = 0; i < admins.length; i++) {
            address a = admins[i];
            if (a == address(0)) revert InvalidResolutionAdmin();
            for (uint256 j = 0; j < i; j++) {
                if (admins[j] == a) revert InvalidResolutionAdmin();
            }
            resolutionAdmins.push(a);
            isResolutionAdmin[a] = true;
        }
    }

    function resolutionThreshold() external pure returns (uint256) {
        return RESOLUTION_THRESHOLD;
    }

    function setPriceFeed(bytes32 assetKey, address feed) external onlyOwner {
        if (assetKey == bytes32(0)) revert InvalidFeed();
        priceFeeds[assetKey] = feed;
        emit PriceFeedUpdated(assetKey, feed);
    }

    struct FpmmMarketParams {
        address collateralToken;
        uint8 collateralDecimals;
        uint256 stakeEndTimestamp;
        uint256 resolveAfterTimestamp;
        bytes32 metadataHash;
        string[] outcomeLabels;
        string metadataURI;
        uint256 minInitialFunding;
        uint256 initialFunding;
        uint256[] fundingHint;
        address shareRecipient;
    }

    struct PriceMarketParams {
        FpmmMarketParams base;
        bytes32 priceAssetKey;
        uint256 priceThreshold;
        ZedkrFpmmMarket.PriceThresholdKind priceKind;
        uint256 priceUpperBound;
        uint256 maxPriceStaleness;
        uint256[] priceBinLower;
        uint256[] priceBinUpper;
    }

    function createPriceMarket(PriceMarketParams calldata p) external returns (address market) {
        _requireCollateral(p.base.collateralToken);
        if (p.base.outcomeLabels.length < 2 || p.base.outcomeLabels.length > 32) revert InvalidOutcomes();
        if (p.priceAssetKey == bytes32(0)) revert InvalidFeed();
        address feed = priceFeeds[p.priceAssetKey];
        if (feed == address(0)) revert InvalidFeed();
        if (p.maxPriceStaleness == 0) revert InvalidConfig();
        if (p.base.stakeEndTimestamp <= block.timestamp || p.base.resolveAfterTimestamp <= p.base.stakeEndTimestamp) {
            revert InvalidTime();
        }
        if (p.base.metadataHash == bytes32(0)) revert InvalidMeta();
        if (p.base.initialFunding < p.base.minInitialFunding) revert InvalidFunding();

        if (p.priceBinLower.length > 0) {
            if (p.priceBinLower.length != p.base.outcomeLabels.length || p.priceBinUpper.length != p.base.outcomeLabels.length) {
                revert InvalidBins();
            }
        } else {
            if (p.base.outcomeLabels.length != 2) revert InvalidBins();
        }

        if (marketDeployer == address(0)) revert InvalidDeployer();
        address[] memory tokens;
        (market, tokens) = ZedkrFpmmDeployer(marketDeployer).deployPriceMarket(
            owner(),
            feeRecipient,
            msg.sender,
            p.base.collateralToken,
            p.base.collateralDecimals,
            uint8(p.base.outcomeLabels.length),
            p.base.stakeEndTimestamp,
            p.base.resolveAfterTimestamp,
            p.base.metadataHash,
            feed,
            p.priceThreshold,
            p.priceKind,
            p.priceUpperBound,
            p.maxPriceStaleness,
            p.base.minInitialFunding,
            p.base.outcomeLabels
        );

        _wireAndFund(
            market,
            tokens,
            p.base,
            p.priceBinLower,
            p.priceBinUpper
        );
        _register(
            market,
            ZedkrFpmmMarket.MarketKind.PRICE,
            p.base.collateralToken,
            tokens,
            p.base.outcomeLabels,
            p.base.stakeEndTimestamp,
            p.base.resolveAfterTimestamp,
            p.base.metadataHash,
            msg.sender
        );
    }

    function createEventMarket(FpmmMarketParams calldata p) external returns (address market) {
        market = _createResolutionMarket(p, ZedkrFpmmMarket.MarketKind.EVENT);
    }

    function createPonsMarket(FpmmMarketParams calldata p) external returns (address market) {
        market = _createResolutionMarket(p, ZedkrFpmmMarket.MarketKind.PONS_TOKEN);
    }

    function getMarketOutcomeTokens(address market) external view returns (address[] memory) {
        return _marketOutcomeTokens[market];
    }

    /// @notice True if `token` is a registered outcome ERC20 for `market` (OrderBook / CLOB).
    function isOutcomeTokenForMarket(address market, address token) external view returns (bool) {
        address[] storage arr = _marketOutcomeTokens[market];
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == token) return true;
        }
        return false;
    }

    function marketsLength() external view returns (uint256) {
        return markets.length;
    }

    function _createResolutionMarket(FpmmMarketParams calldata p, ZedkrFpmmMarket.MarketKind kind)
        internal
        returns (address market)
    {
        _requireCollateral(p.collateralToken);
        if (p.outcomeLabels.length < 2 || p.outcomeLabels.length > 32) revert InvalidOutcomes();
        if (p.stakeEndTimestamp <= block.timestamp || p.resolveAfterTimestamp <= p.stakeEndTimestamp) revert InvalidTime();
        if (p.metadataHash == bytes32(0)) revert InvalidMeta();
        if (p.initialFunding < p.minInitialFunding) revert InvalidFunding();
        if (marketDeployer == address(0)) revert InvalidDeployer();

        address[] memory tokens;
        if (kind == ZedkrFpmmMarket.MarketKind.EVENT) {
            (market, tokens) = ZedkrFpmmDeployer(marketDeployer).deployEventMarket(
                owner(),
                feeRecipient,
                msg.sender,
                p.collateralToken,
                p.collateralDecimals,
                uint8(p.outcomeLabels.length),
                p.stakeEndTimestamp,
                p.resolveAfterTimestamp,
                p.metadataHash,
                p.minInitialFunding,
                p.outcomeLabels
            );
        } else {
            (market, tokens) = ZedkrFpmmDeployer(marketDeployer).deployPonsMarket(
                owner(),
                feeRecipient,
                msg.sender,
                p.collateralToken,
                p.collateralDecimals,
                uint8(p.outcomeLabels.length),
                p.stakeEndTimestamp,
                p.resolveAfterTimestamp,
                p.metadataHash,
                p.minInitialFunding,
                p.outcomeLabels
            );
        }

        _wireAndFund(market, tokens, p, new uint256[](0), new uint256[](0));
        _register(
            market,
            kind,
            p.collateralToken,
            tokens,
            p.outcomeLabels,
            p.stakeEndTimestamp,
            p.resolveAfterTimestamp,
            p.metadataHash,
            msg.sender
        );
    }

    function _wireAndFund(
        address market,
        address[] memory tokens,
        FpmmMarketParams calldata p,
        uint256[] memory binLower,
        uint256[] memory binUpper
    ) internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            ZedkrOutcomeToken(tokens[i]).transferOwnership(market);
        }
        ZedkrFpmmMarket(market).initialize(tokens, binLower, binUpper, p.metadataURI);
        address recipient = p.shareRecipient == address(0) ? msg.sender : p.shareRecipient;
        IERC20(p.collateralToken).safeTransferFrom(msg.sender, address(this), p.initialFunding);
        IERC20(p.collateralToken).forceApprove(market, p.initialFunding);
        ZedkrFpmmMarket(market).addFunding(p.initialFunding, p.fundingHint, recipient);
    }

    function _register(
        address market,
        ZedkrFpmmMarket.MarketKind kind,
        address collateralToken,
        address[] memory tokens,
        string[] memory labels,
        uint256 stakeEnd,
        uint256 resolveAfter,
        bytes32 metadataHash,
        address creator
    ) internal {
        markets.push(market);
        isMarket[market] = true;
        for (uint256 i = 0; i < tokens.length; i++) {
            _marketOutcomeTokens[market].push(tokens[i]);
        }
        emit MarketCreated(
            market,
            kind,
            collateralToken,
            tokens,
            labels,
            stakeEnd,
            resolveAfter,
            metadataHash,
            creator
        );
    }

    function _requireCollateral(address token) internal view {
        if (!collateralRegistry.isWhitelisted(token)) revert InvalidCollateral();
    }

    /// @notice UI / script compatibility — mirrors parimutuel factory naming.
    function isSupportedCollateral(address token) external view returns (bool) {
        return collateralRegistry.isWhitelisted(token);
    }
}

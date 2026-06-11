// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../token/MondaloreOutcomeToken.sol";
import "../core/MondaloreVParimutuelMarket.sol";
import "./MondaloreParimutuelDeployer.sol";

interface IWETH {
    function deposit() external payable;
}

/// @title MondaloreParimutuelMarketFactory
/// @notice Core vPari factory (single-market creates). Batch deployment lives in MondaloreParimutuelBatchFactory.
contract MondaloreParimutuelMarketFactory is Ownable2Step {
    using SafeERC20 for IERC20;
    error InvalidAddress();
    error NotCreator();
    error InvalidCollateral();
    error InvalidConfig();
    error InvalidOutcomes();
    error InvalidFeed();
    error InvalidTime();
    error InvalidMeta();
    error InvalidBins();
    error InvalidDeployer();
    error InvalidBootstrap();
    error TooManyResolutionAdmins();
    error InvalidResolutionAdmin();

    uint256 public constant MAX_RESOLUTION_ADMINS = 10;
    uint256 public constant RESOLUTION_THRESHOLD = 3;

    mapping(address => bool) public isResolutionAdmin;
    address[] public resolutionAdmins;

    mapping(address => bool) public isSupportedCollateral;

    /// @notice Registered Chainlink (or mock) feed per asset key, e.g. keccak256(abi.encodePacked("BTC")).
    mapping(bytes32 => address) public priceFeeds;

    address public feeRecipient;
    address public optimisticOracleV2;
    /// @notice Default UMA bond token (WETH on Base / Base Sepolia). Used when EventMarketParams.umaRewardCurrency is address(0).
    address public umaBondCurrency;
    /// @notice Optional helper contract allowed to call create functions.
    address public batchExecutor;
    /// @notice Deploys token + market bytecode (set after deploy: deploy sub-deployers + MondaloreParimutuelDeployer(factory, priceDep, eventDep), then setMarketDeployer).
    address public marketDeployer;
    /// @notice Wrapped native token (MockWETH on Monad testnet). Native MON markets wrap bootstrap into this ERC20.
    address public wrappedNativeToken;

    address[] public markets;
    mapping(address => bool) public isMarket;
    mapping(address => address[]) private _marketOutcomeTokens;

    event SupportedCollateralAdded(address indexed token);
    event SupportedCollateralRemoved(address indexed token);
    event PriceFeedUpdated(bytes32 indexed assetKey, address feed);
    event FeeRecipientUpdated(address indexed recipient);
    event OptimisticOracleV2Updated(address indexed oracle);
    event UmaBondCurrencyUpdated(address indexed currency);
    event MarketDeployerUpdated(address indexed deployer);
    event WrappedNativeTokenUpdated(address indexed token);

    event MarketCreated(
        address indexed market,
        MondaloreVParimutuelMarket.MarketKind indexed kind,
        address indexed collateralToken,
        address[] outcomeTokens,
        string[] outcomeLabels,
        uint256 stakeEndTimestamp,
        uint256 resolveAfterTimestamp,
        bytes32 metadataHash,
        address creator
    );

    constructor(address owner_, address feeRecipient_, address optimisticOracleV2_, address umaBondCurrency_) Ownable(owner_) {
        if (feeRecipient_ == address(0)) revert InvalidAddress();
        feeRecipient = feeRecipient_;
        optimisticOracleV2 = optimisticOracleV2_;
        umaBondCurrency = umaBondCurrency_;
    }

    modifier onlyCreator() {
        if (msg.sender != owner() && msg.sender != batchExecutor) revert NotCreator();
        _;
    }

    function setFeeRecipient(address r) external onlyOwner {
        if (r == address(0)) revert InvalidAddress();
        feeRecipient = r;
        emit FeeRecipientUpdated(r);
    }

    function setOptimisticOracleV2(address oo) external onlyOwner {
        optimisticOracleV2 = oo;
        emit OptimisticOracleV2Updated(oo);
    }

    function setBatchExecutor(address executor) external onlyOwner {
        batchExecutor = executor;
    }

    function setMarketDeployer(address d) external onlyOwner {
        if (d == address(0)) revert InvalidAddress();
        marketDeployer = d;
        emit MarketDeployerUpdated(d);
    }

    function setWrappedNativeToken(address token) external onlyOwner {
        if (token == address(0)) revert InvalidAddress();
        wrappedNativeToken = token;
        emit WrappedNativeTokenUpdated(token);
    }

    function setUmaBondCurrency(address c) external onlyOwner {
        umaBondCurrency = c;
        emit UmaBondCurrencyUpdated(c);
    }

    /// @notice Set up to 10 wallets allowed to sign EVENT market resolutions (3-of-10 required on-chain).
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

    function resolutionAdminsLength() external view returns (uint256) {
        return resolutionAdmins.length;
    }

    function addSupportedCollateral(address token) external onlyOwner {
        if (isSupportedCollateral[token]) revert InvalidConfig();
        isSupportedCollateral[token] = true;
        emit SupportedCollateralAdded(token);
    }

    function removeSupportedCollateral(address token) external onlyOwner {
        if (!isSupportedCollateral[token]) revert InvalidConfig();
        isSupportedCollateral[token] = false;
        emit SupportedCollateralRemoved(token);
    }

    /// @notice Register or disable a price feed for an asset key (e.g. keccak256(abi.encodePacked("BTC"))).
    /// @dev Pass feed = address(0) to disable market creation for that asset.
    function setPriceFeed(bytes32 assetKey, address feed) external onlyOwner {
        if (assetKey == bytes32(0)) revert InvalidFeed();
        priceFeeds[assetKey] = feed;
        emit PriceFeedUpdated(assetKey, feed);
    }

    /// @notice True if `token` is a registered outcome ERC20 for `market`.
    function isOutcomeTokenForMarket(address market, address token) external view returns (bool) {
        address[] storage arr = _marketOutcomeTokens[market];
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == token) return true;
        }
        return false;
    }

    struct PriceMarketParams {
        address collateralToken;
        uint8 collateralDecimals;
        uint256 virtualReserve;
        uint256 stakeEndTimestamp;
        uint256 resolveAfterTimestamp;
        bytes32 metadataHash;
        string[] outcomeLabels;
        /// @notice UI / app metadata (e.g. `ipfs://...`), persisted for price markets too.
        string metadataURI;
        /// @notice Asset key, e.g. keccak256(abi.encodePacked("BTC")). Must be registered via setPriceFeed.
        bytes32 priceAssetKey;
        uint256 priceThreshold;
        MondaloreVParimutuelMarket.PriceThresholdKind priceKind;
        uint256 priceUpperBound;
        uint256 maxPriceStaleness;
        uint256[] priceBinLower;
        uint256[] priceBinUpper;
        /// @notice Minimum `totalAmount` for permissionless `bootstrapLiquidity` (0 = only >0 and divisible).
        uint256 minBootstrapTotal;
        /// @notice Bootstrap liquidity amount (must be >= minBootstrapTotal and divisible by numOutcomes).
        uint256 bootstrapAmount;
        /// @notice Recipient of bootstrap shares (typically msg.sender or a liquidity pool).
        address shareRecipient;
    }

    struct EventMarketParams {
        address collateralToken;
        uint8 collateralDecimals;
        uint256 virtualReserve;
        uint256 stakeEndTimestamp;
        uint256 resolveAfterTimestamp;
        bytes32 metadataHash;
        string[] outcomeLabels;
        /// @notice UI / app metadata (e.g. `ipfs://...`).
        string metadataURI;
        uint256 minBootstrapTotal;
        /// @notice Bootstrap liquidity amount (must be >= minBootstrapTotal and divisible by numOutcomes).
        uint256 bootstrapAmount;
        /// @notice Recipient of bootstrap shares (typically msg.sender or a liquidity pool).
        address shareRecipient;
    }

    function createPriceMarket(PriceMarketParams calldata p) external payable returns (address market) {
        market = _createPriceMarket(p, msg.sender);
    }

    function createEventMarket(EventMarketParams calldata p) external payable returns (address market) {
        market = _createEventMarket(p, msg.sender);
    }

    function getMarketOutcomeTokens(address market) external view returns (address[] memory) {
        return _marketOutcomeTokens[market];
    }

    /// @notice Total number of created markets.
    function marketsLength() external view returns (uint256) {
        return markets.length;
    }

    function _decimalsForCollateral(address token, uint8 templateDec) internal pure returns (uint8) {
        if (token == address(0)) return 18;
        return templateDec;
    }

    /// @dev `collateralToken == address(0)` means native MON when registered; market uses `wrappedNativeToken`.
    function _resolveCollateral(address collateralToken) internal view returns (address effective, bool isNativeInput) {
        if (collateralToken == address(0)) {
            if (wrappedNativeToken == address(0) || !isSupportedCollateral[address(0)]) revert InvalidCollateral();
            return (wrappedNativeToken, true);
        }
        if (!isSupportedCollateral[collateralToken]) revert InvalidCollateral();
        return (collateralToken, false);
    }

    function _createPriceMarket(PriceMarketParams calldata p, address creator) internal returns (address) {
        (address effectiveCollateral, bool isNativeInput) = _resolveCollateral(p.collateralToken);
        uint8 collateralDecimals = isNativeInput ? 18 : _decimalsForCollateral(p.collateralToken, p.collateralDecimals);
        if (p.outcomeLabels.length < 2 || p.outcomeLabels.length > 32) revert InvalidOutcomes();
        // Fix #8: explicit bounds check before uint8 cast (defensive — the >32 check above already
        // prevents truncation, but this makes the intent unambiguous).
        require(p.outcomeLabels.length <= type(uint8).max, "Labels overflow");
        if (p.priceAssetKey == bytes32(0)) revert InvalidFeed();
        address chainlinkFeed = priceFeeds[p.priceAssetKey];
        if (chainlinkFeed == address(0)) revert InvalidFeed();
        if (p.maxPriceStaleness == 0) revert InvalidConfig();
        if (p.stakeEndTimestamp <= block.timestamp || p.resolveAfterTimestamp <= p.stakeEndTimestamp) revert InvalidTime();
        if (p.metadataHash == bytes32(0)) revert InvalidMeta();

        if (p.priceBinLower.length > 0) {
            if (p.priceBinLower.length != p.outcomeLabels.length || p.priceBinUpper.length != p.outcomeLabels.length) {
                revert InvalidBins();
            }
        } else {
            if (p.outcomeLabels.length != 2) revert InvalidBins();
            if (p.priceKind == MondaloreVParimutuelMarket.PriceThresholdKind.IN_RANGE) {
                if (p.priceThreshold >= p.priceUpperBound) revert InvalidConfig();
            }
        }

        if (marketDeployer == address(0)) revert InvalidDeployer();
        (address market, address[] memory tokens) = MondaloreParimutuelDeployer(marketDeployer).deployPriceMarket(
            owner(),
            feeRecipient,
            creator,
            effectiveCollateral,
            collateralDecimals,
            uint8(p.outcomeLabels.length),
            p.virtualReserve,
            p.stakeEndTimestamp,
            p.resolveAfterTimestamp,
            p.metadataHash,
            chainlinkFeed,
            p.priceThreshold,
            p.priceKind,
            p.priceUpperBound,
            p.maxPriceStaleness,
            p.minBootstrapTotal,
            p.outcomeLabels
        );

        _wireMarket(market, tokens, p.metadataURI, p.priceBinLower, p.priceBinUpper);
        _seedMarket(market, effectiveCollateral, isNativeInput, p.bootstrapAmount, p.shareRecipient, uint8(p.outcomeLabels.length));
        _register(
            market,
            MondaloreVParimutuelMarket.MarketKind.PRICE,
            effectiveCollateral,
            tokens,
            p.outcomeLabels,
            p.stakeEndTimestamp,
            p.resolveAfterTimestamp,
            p.metadataHash,
            creator
        );
        return market;
    }

    function _createEventMarket(EventMarketParams calldata p, address creator) internal returns (address) {
        (address effectiveCollateral, bool isNativeInput) = _resolveCollateral(p.collateralToken);
        uint8 collateralDecimals = isNativeInput ? 18 : _decimalsForCollateral(p.collateralToken, p.collateralDecimals);
        if (p.outcomeLabels.length < 2 || p.outcomeLabels.length > 32) revert InvalidOutcomes();
        // Fix #8: explicit bounds check before uint8 cast.
        require(p.outcomeLabels.length <= type(uint8).max, "Labels overflow");
        if (resolutionAdmins.length < RESOLUTION_THRESHOLD) revert InvalidConfig();
        if (p.stakeEndTimestamp <= block.timestamp || p.resolveAfterTimestamp <= p.stakeEndTimestamp) revert InvalidTime();
        if (p.metadataHash == bytes32(0)) revert InvalidMeta();

        if (marketDeployer == address(0)) revert InvalidDeployer();
        (address market, address[] memory tokens) = MondaloreParimutuelDeployer(marketDeployer).deployEventMarket(
            owner(),
            feeRecipient,
            creator,
            effectiveCollateral,
            collateralDecimals,
            uint8(p.outcomeLabels.length),
            p.virtualReserve,
            p.stakeEndTimestamp,
            p.resolveAfterTimestamp,
            p.metadataHash,
            p.minBootstrapTotal,
            p.outcomeLabels
        );

        _wireMarket(market, tokens, p.metadataURI, _emptyBins(), _emptyBins());
        _seedMarket(market, effectiveCollateral, isNativeInput, p.bootstrapAmount, p.shareRecipient, uint8(p.outcomeLabels.length));
        _register(
            market,
            MondaloreVParimutuelMarket.MarketKind.EVENT,
            effectiveCollateral,
            tokens,
            p.outcomeLabels,
            p.stakeEndTimestamp,
            p.resolveAfterTimestamp,
            p.metadataHash,
            creator
        );
        return market;
    }

    function _emptyBins() internal pure returns (uint256[] memory z) {
        z = new uint256[](0);
    }

    /// @notice Pull bootstrap collateral from msg.sender and seed the market atomically.
    /// @dev Native MON (`isNativeInput`): caller sends `bootstrapAmount` as msg.value; factory wraps to WETH then seeds.
    ///      ERC20: caller must have pre-approved this factory for `bootstrapAmount`; msg.value must be 0.
    function _seedMarket(
        address market,
        address effectiveCollateral,
        bool isNativeInput,
        uint256 bootstrapAmount,
        address shareRecipient,
        uint8 numOutcomes
    ) internal {
        if (bootstrapAmount == 0) revert InvalidBootstrap();
        if (shareRecipient == address(0)) revert InvalidBootstrap();
        if (bootstrapAmount % uint256(numOutcomes) != 0) revert InvalidBootstrap();

        if (isNativeInput) {
            if (msg.value != bootstrapAmount) revert InvalidBootstrap();
            IWETH(wrappedNativeToken).deposit{value: bootstrapAmount}();
            IERC20(effectiveCollateral).forceApprove(market, bootstrapAmount);
            MondaloreVParimutuelMarket(payable(market)).bootstrapLiquidity(bootstrapAmount, shareRecipient);
        } else {
            if (msg.value != 0) revert InvalidBootstrap();
            IERC20(effectiveCollateral).safeTransferFrom(msg.sender, address(this), bootstrapAmount);
            IERC20(effectiveCollateral).forceApprove(market, bootstrapAmount);
            MondaloreVParimutuelMarket(payable(market)).bootstrapLiquidity(bootstrapAmount, shareRecipient);
        }
    }

    function _wireMarket(
        address market,
        address[] memory tokens,
        string memory metadataURI,
        uint256[] memory binLo,
        uint256[] memory binHi
    ) internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            MondaloreOutcomeToken(tokens[i]).transferOwnership(market);
        }
        MondaloreVParimutuelMarket(payable(market)).initialize(tokens, binLo, binHi, metadataURI);
    }

    function _register(
        address market,
        MondaloreVParimutuelMarket.MarketKind kind,
        address collateral,
        address[] memory tokens,
        string[] memory labels,
        uint256 stakeEnd,
        uint256 resolveAfter,
        bytes32 meta,
        address creator
    ) internal {
        markets.push(market);
        isMarket[market] = true;
        for (uint256 i = 0; i < tokens.length; i++) {
            _marketOutcomeTokens[market].push(tokens[i]);
        }
        emit MarketCreated(market, kind, collateral, tokens, labels, stakeEnd, resolveAfter, meta, creator);
    }

}

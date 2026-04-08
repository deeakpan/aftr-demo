// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "../token/AFTROutcomeToken.sol";
import "../core/AFTRVParimutuelMarket.sol";
import "../config/AFTRUmaIdentifiers.sol";
import "./AFTRParimutuelDeployer.sol";

/// @title AFTRParimutuelMarketFactory
/// @notice Core vPari factory (single-market creates). Batch deployment lives in AFTRParimutuelBatchFactory.
contract AFTRParimutuelMarketFactory is Ownable2Step {
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
    mapping(address => bool) public isSupportedCollateral;

    address public feeRecipient;
    address public optimisticOracleV2;
    /// @notice Default UMA bond token (WETH on Base / Base Sepolia). Used when EventMarketParams.umaRewardCurrency is address(0).
    address public umaBondCurrency;
    /// @notice Optional helper contract allowed to call create functions.
    address public batchExecutor;
    /// @notice Deploys token + market bytecode (set after deploy: deploy AFTRParimutuelDeployer(factory), then setMarketDeployer).
    address public marketDeployer;

    address[] public markets;
    mapping(address => bool) public isMarket;
    mapping(address => address[]) private _marketOutcomeTokens;

    event SupportedCollateralAdded(address indexed token);
    event SupportedCollateralRemoved(address indexed token);
    event FeeRecipientUpdated(address indexed recipient);
    event OptimisticOracleV2Updated(address indexed oracle);
    event UmaBondCurrencyUpdated(address indexed currency);
    event MarketDeployerUpdated(address indexed deployer);

    event MarketCreated(
        address indexed market,
        AFTRVParimutuelMarket.MarketKind indexed kind,
        address indexed collateralToken,
        address[] outcomeTokens,
        string[] outcomeLabels,
        uint256 stakeEndTimestamp,
        uint256 resolveAfterTimestamp,
        bytes32 metadataHash
    );

    constructor(address owner_, address feeRecipient_, address optimisticOracleV2_, address umaBondCurrency_) Ownable(owner_) {
        if (feeRecipient_ == address(0) || umaBondCurrency_ == address(0)) revert InvalidAddress();
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

    function setUmaBondCurrency(address c) external onlyOwner {
        if (c == address(0)) revert InvalidAddress();
        umaBondCurrency = c;
        emit UmaBondCurrencyUpdated(c);
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
        address chainlinkFeed;
        uint256 priceThreshold;
        AFTRVParimutuelMarket.PriceThresholdKind priceKind;
        uint256 priceUpperBound;
        uint256 maxPriceStaleness;
        uint256[] priceBinLower;
        uint256[] priceBinUpper;
        /// @notice Minimum `totalAmount` for permissionless `bootstrapLiquidity` (0 = only >0 and divisible).
        uint256 minBootstrapTotal;
    }

    struct EventMarketParams {
        address collateralToken;
        uint8 collateralDecimals;
        uint256 virtualReserve;
        uint256 stakeEndTimestamp;
        uint256 resolveAfterTimestamp;
        bytes32 metadataHash;
        string[] outcomeLabels;
        /// @notice UI / app metadata (e.g. `ipfs://...`); not sent to UMA.
        string metadataURI;
        /// @notice UTF-8 ancillary data for the OO request (the human question or UMIP-formatted payload). Max 8192 bytes.
        string umaAncillary;
        /// @notice OO price identifier. `0` => `YES_OR_NO_QUERY` if 2 outcomes, else `MULTIPLE_CHOICE_QUERY` (UMIP-181).
        bytes32 umaIdentifier;
        uint64 umaLiveness;
        /// @notice OO proposer/disputer bond on top of final fee (0 = use OO default only).
        uint256 umaProposerBond;
        uint256 umaReward;
        /// @notice UMA bond token; address(0) => factory `umaBondCurrency` (WETH on Base testnets).
        address umaRewardCurrency;
        uint256 minBootstrapTotal;
    }

    function createPriceMarket(PriceMarketParams calldata p) external onlyCreator returns (address market) {
        market = _createPriceMarket(p);
    }

    function createEventMarket(EventMarketParams calldata p) external onlyCreator returns (address market) {
        market = _createEventMarket(p);
    }

    function getMarketOutcomeTokens(address market) external view returns (address[] memory) {
        return _marketOutcomeTokens[market];
    }

    function _decimalsForCollateral(address token, uint8 templateDec) internal pure returns (uint8) {
        if (token == address(0)) return 18;
        return templateDec;
    }

    function _createPriceMarket(PriceMarketParams calldata p) internal returns (address) {
        uint8 collateralDecimals = _decimalsForCollateral(p.collateralToken, p.collateralDecimals);
        if (!isSupportedCollateral[p.collateralToken]) revert InvalidCollateral();
        if (p.collateralToken == address(0) && collateralDecimals != 18) revert InvalidConfig();
        if (p.outcomeLabels.length < 2 || p.outcomeLabels.length > 32) revert InvalidOutcomes();
        if (p.chainlinkFeed == address(0)) revert InvalidFeed();
        if (p.maxPriceStaleness == 0) revert InvalidConfig();
        if (p.stakeEndTimestamp <= block.timestamp || p.resolveAfterTimestamp <= p.stakeEndTimestamp) revert InvalidTime();
        if (p.metadataHash == bytes32(0)) revert InvalidMeta();

        if (p.priceBinLower.length > 0) {
            if (p.priceBinLower.length != p.outcomeLabels.length || p.priceBinUpper.length != p.outcomeLabels.length) {
                revert InvalidBins();
            }
        } else {
            if (p.outcomeLabels.length != 2) revert InvalidBins();
            if (p.priceKind == AFTRVParimutuelMarket.PriceThresholdKind.IN_RANGE) {
                if (p.priceThreshold >= p.priceUpperBound) revert InvalidConfig();
            }
        }

        if (marketDeployer == address(0)) revert InvalidDeployer();
        (address market, address[] memory tokens) = AFTRParimutuelDeployer(marketDeployer).deployPriceMarket(
            owner(),
            feeRecipient,
            p.collateralToken,
            collateralDecimals,
            uint8(p.outcomeLabels.length),
            p.virtualReserve,
            p.stakeEndTimestamp,
            p.resolveAfterTimestamp,
            p.metadataHash,
            p.chainlinkFeed,
            p.priceThreshold,
            p.priceKind,
            p.priceUpperBound,
            p.maxPriceStaleness,
            p.minBootstrapTotal,
            p.outcomeLabels
        );

        _wireMarket(market, tokens, "", new bytes(0), p.priceBinLower, p.priceBinUpper);
        _register(
            market,
            AFTRVParimutuelMarket.MarketKind.PRICE,
            p.collateralToken,
            tokens,
            p.outcomeLabels,
            p.stakeEndTimestamp,
            p.resolveAfterTimestamp,
            p.metadataHash
        );
        return market;
    }

    function _createEventMarket(EventMarketParams calldata p) internal returns (address) {
        uint8 collateralDecimals = _decimalsForCollateral(p.collateralToken, p.collateralDecimals);
        if (!isSupportedCollateral[p.collateralToken]) revert InvalidCollateral();
        if (p.collateralToken == address(0) && collateralDecimals != 18) revert InvalidConfig();
        if (p.outcomeLabels.length < 2 || p.outcomeLabels.length > 32) revert InvalidOutcomes();
        bytes memory anc = bytes(p.umaAncillary);
        if (anc.length == 0 || anc.length > 8192) revert InvalidConfig();
        if (p.umaLiveness == 0) revert InvalidConfig();
        bytes32 umaId = p.umaIdentifier;
        if (umaId == bytes32(0)) {
            umaId = p.outcomeLabels.length == 2
                ? AFTRUmaIdentifiers.YES_OR_NO_QUERY
                : AFTRUmaIdentifiers.MULTIPLE_CHOICE_QUERY;
        }
        if (umaId == AFTRUmaIdentifiers.YES_OR_NO_QUERY && p.outcomeLabels.length != 2) revert InvalidConfig();
        if (optimisticOracleV2 == address(0)) revert InvalidConfig();
        address bondToken = p.umaRewardCurrency != address(0) ? p.umaRewardCurrency : umaBondCurrency;
        if (bondToken == address(0)) revert InvalidConfig();
        if (p.stakeEndTimestamp <= block.timestamp || p.resolveAfterTimestamp <= p.stakeEndTimestamp) revert InvalidTime();
        if (p.metadataHash == bytes32(0)) revert InvalidMeta();

        if (marketDeployer == address(0)) revert InvalidDeployer();
        (address market, address[] memory tokens) = AFTRParimutuelDeployer(marketDeployer).deployEventMarket(
            owner(),
            feeRecipient,
            p.collateralToken,
            collateralDecimals,
            uint8(p.outcomeLabels.length),
            p.virtualReserve,
            p.stakeEndTimestamp,
            p.resolveAfterTimestamp,
            p.metadataHash,
            optimisticOracleV2,
            umaId,
            p.umaLiveness,
            p.umaProposerBond,
            p.umaReward,
            bondToken,
            p.minBootstrapTotal,
            p.outcomeLabels
        );

        _wireMarket(market, tokens, p.metadataURI, anc, _emptyBins(), _emptyBins());
        _register(
            market,
            AFTRVParimutuelMarket.MarketKind.EVENT,
            p.collateralToken,
            tokens,
            p.outcomeLabels,
            p.stakeEndTimestamp,
            p.resolveAfterTimestamp,
            p.metadataHash
        );
        return market;
    }

    function _emptyBins() internal pure returns (uint256[] memory z) {
        z = new uint256[](0);
    }

    function _wireMarket(
        address market,
        address[] memory tokens,
        string memory metadataURI,
        bytes memory umaAncillary,
        uint256[] memory binLo,
        uint256[] memory binHi
    ) internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            AFTROutcomeToken(tokens[i]).transferOwnership(market);
        }
        AFTRVParimutuelMarket(payable(market)).initialize(tokens, binLo, binHi, metadataURI, umaAncillary);
    }

    function _register(
        address market,
        AFTRVParimutuelMarket.MarketKind kind,
        address collateral,
        address[] memory tokens,
        string[] memory labels,
        uint256 stakeEnd,
        uint256 resolveAfter,
        bytes32 meta
    ) internal {
        markets.push(market);
        isMarket[market] = true;
        for (uint256 i = 0; i < tokens.length; i++) {
            _marketOutcomeTokens[market].push(tokens[i]);
        }
        emit MarketCreated(market, kind, collateral, tokens, labels, stakeEnd, resolveAfter, meta);
    }

}

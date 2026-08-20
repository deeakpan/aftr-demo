// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../token/ZedkrOutcomeToken.sol";
import "../fpmm/ZedkrFpmmMath.sol";
import "../interfaces/IMondaloreAggregatorV3.sol";
import "../interfaces/IMondaloreMarketFactoryResolution.sol";

/// @title ZedkrFpmmMarket
/// @notice Gnosis-style fixed-payout FPMM for Zedkr: constant-product trading, admin/oracle resolution.
/// @dev Each outcome share redeems for 1 unit of collateral when that outcome wins.
contract ZedkrFpmmMarket is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant TRADE_FEE_TOTAL_BPS = 100;
    uint256 public constant CREATOR_FEE_BPS = 60;
    uint256 public constant PROTOCOL_FEE_BPS = 40;
    uint256 public constant MIN_TRADE = 1000;
    uint256 public constant FIXED_REDEMPTION_RATE = 1e18;

    bytes32 private constant EVENT_RESOLUTION_TYPEHASH =
        keccak256("EventResolution(address market,uint8 outcomeIndex,uint256 chainId)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant EIP712_NAME_HASH = keccak256("Zedkr Market");
    bytes32 private constant EIP712_VERSION_HASH = keccak256("1");

    enum MarketKind {
        PRICE,
        EVENT,
        PONS_TOKEN
    }

    enum PriceThresholdKind {
        ABOVE,
        BELOW,
        IN_RANGE
    }

    enum MarketState {
        OPEN,
        _RESERVED,
        SETTLED
    }

    address public immutable factory;
    address public immutable feeRecipient;
    address public immutable creator;
    address public immutable collateralToken;
    uint8 public immutable collateralDecimals;
    uint8 public immutable numOutcomes;
    uint256 public immutable stakeEndTimestamp;
    uint256 public immutable resolveAfterTimestamp;
    MarketKind public immutable marketKind;
    bytes32 public immutable metadataHash;
    uint256 public immutable minInitialFunding;

    address public immutable chainlinkFeed;
    uint256 public immutable priceThreshold;
    PriceThresholdKind public immutable priceThresholdKind;
    uint256 public immutable priceUpperBound;
    uint256 public immutable maxPriceStaleness;

    ZedkrOutcomeToken[] private _outcomeTokens;
    uint256[] public poolBalances;
    uint256[] public priceBinLower;
    uint256[] public priceBinUpper;

    bool public initialized;
    bool public funded;
    MarketState public state;
    string public metadataURI;

    uint256 public winningOutcomeIndex;
    uint256 public redemptionRate;
    int256 public settledOraclePrice;
    uint256 public settlementTimestamp;

    event MarketInitialized(address[] outcomeTokens, string metadataURI);
    event FundingAdded(address indexed funder, uint256 amount, uint256[] poolAmounts);
    event FpmmBuy(
        address indexed buyer,
        uint8 indexed outcomeIndex,
        uint256 investmentAmount,
        uint256 outcomeTokensBought,
        uint256 price1e18
    );
    event FpmmSell(
        address indexed seller,
        uint8 indexed outcomeIndex,
        uint256 returnAmount,
        uint256 outcomeTokensSold
    );
    event MarketSettled(uint256 winningOutcomeIndex);
    event TokensRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout);
    event EventResolved(uint8 indexed outcomeIndex, address indexed caller, uint256 adminSignatures);
    event PonsTokenResolved(uint8 indexed outcomeIndex, address indexed resolver);

    error OnlyFactory();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidOutcome();
    error StakePeriodEnded();
    error TooEarlyToResolve();
    error MarketNotOpen();
    error InvalidState();
    error ZeroAmount();
    error Slippage();
    error AlreadyFunded();
    error BelowMinFunding();
    error InvalidShareRecipient();
    error InvalidResolutionSignatures();
    error NotPonsResolutionAdmin();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(
        address factory_,
        address owner_,
        address feeRecipient_,
        address creator_,
        address collateralToken_,
        uint8 collateralDecimals_,
        uint8 numOutcomes_,
        uint256 stakeEndTimestamp_,
        uint256 resolveAfterTimestamp_,
        MarketKind kind_,
        bytes32 metadataHash_,
        address chainlinkFeed_,
        uint256 priceThreshold_,
        PriceThresholdKind priceKind_,
        uint256 priceUpperBound_,
        uint256 maxPriceStaleness_,
        uint256 minInitialFunding_
    ) Ownable(owner_) {
        require(
            factory_ != address(0) && owner_ != address(0) && feeRecipient_ != address(0) && creator_ != address(0),
            "Zero address"
        );
        require(collateralToken_ != address(0), "Collateral");
        require(numOutcomes_ >= 2 && numOutcomes_ <= 32, "Outcomes range");
        require(stakeEndTimestamp_ > block.timestamp, "Stake end past");
        require(resolveAfterTimestamp_ > stakeEndTimestamp_, "Resolve order");
        require(metadataHash_ != bytes32(0), "Metadata");

        factory = factory_;
        feeRecipient = feeRecipient_;
        creator = creator_;
        collateralToken = collateralToken_;
        collateralDecimals = collateralDecimals_;
        numOutcomes = numOutcomes_;
        stakeEndTimestamp = stakeEndTimestamp_;
        resolveAfterTimestamp = resolveAfterTimestamp_;
        marketKind = kind_;
        metadataHash = metadataHash_;
        minInitialFunding = minInitialFunding_;

        if (kind_ == MarketKind.PRICE) {
            require(chainlinkFeed_ != address(0), "Feed");
            require(maxPriceStaleness_ > 0, "Staleness");
            if (priceKind_ == PriceThresholdKind.IN_RANGE) {
                require(priceThreshold_ < priceUpperBound_, "Range bounds");
            }
            chainlinkFeed = chainlinkFeed_;
            priceThreshold = priceThreshold_;
            priceThresholdKind = priceKind_;
            priceUpperBound = priceUpperBound_;
            maxPriceStaleness = maxPriceStaleness_;
        } else {
            chainlinkFeed = address(0);
            priceThreshold = 0;
            priceThresholdKind = PriceThresholdKind.ABOVE;
            priceUpperBound = 0;
            maxPriceStaleness = 0;
        }

        winningOutcomeIndex = type(uint256).max;
    }

    function initialize(
        address[] calldata outcomeTokenAddresses,
        uint256[] calldata binLower,
        uint256[] calldata binUpper,
        string calldata metadataURI_
    ) external onlyFactory {
        if (initialized) revert AlreadyInitialized();
        require(outcomeTokenAddresses.length == uint256(numOutcomes), "Token count");
        initialized = true;

        for (uint256 i = 0; i < outcomeTokenAddresses.length; i++) {
            _outcomeTokens.push(ZedkrOutcomeToken(outcomeTokenAddresses[i]));
            poolBalances.push(0);
        }

        if (marketKind == MarketKind.PRICE && binLower.length > 0) {
            require(binLower.length == uint256(numOutcomes) && binUpper.length == uint256(numOutcomes), "Bins");
            for (uint256 i = 0; i < binLower.length; i++) {
                require(binLower[i] <= binUpper[i], "Bin bounds");
                priceBinLower.push(binLower[i]);
                priceBinUpper.push(binUpper[i]);
            }
        }

        metadataURI = metadataURI_;
        emit MarketInitialized(outcomeTokenAddresses, metadataURI_);
    }

    function outcomeToken(uint256 index) external view returns (address) {
        return address(_outcomeTokens[index]);
    }

    /// @dev Parimutuel / UI compatibility alias.
    function collateralAddress() external view returns (address) {
        return collateralToken;
    }

    function priceOf(uint8 outcomeIndex) external view returns (uint256) {
        if (!initialized) revert NotInitialized();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        uint256[] memory pools = poolBalances;
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i] == 0) return 0;
        }
        return ZedkrFpmmMath.marginalPrice(pools, outcomeIndex);
    }

    /// @notice Seed pool liquidity (creator or factory). `distributionHint` skews starting odds (higher hint = more pool weight).
    function addFunding(uint256 amount, uint256[] calldata distributionHint, address shareRecipient)
        external
        nonReentrant
    {
        if (!initialized) revert NotInitialized();
        if (state != MarketState.OPEN) revert MarketNotOpen();
        if (block.timestamp >= stakeEndTimestamp) revert StakePeriodEnded();
        if (amount == 0 || amount < minInitialFunding) revert BelowMinFunding();
        if (shareRecipient == address(0)) revert InvalidShareRecipient();

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);

        uint256[] memory poolAmounts = new uint256[](uint256(numOutcomes));
        if (!funded) {
            if (distributionHint.length > 0) {
                require(distributionHint.length == uint256(numOutcomes), "Hint length");
                uint256 maxHint;
                for (uint256 i = 0; i < distributionHint.length; i++) {
                    if (distributionHint[i] > maxHint) maxHint = distributionHint[i];
                }
                require(maxHint > 0, "Hint");
                for (uint256 i = 0; i < distributionHint.length; i++) {
                    poolAmounts[i] = (amount * distributionHint[i]) / maxHint;
                    require(poolAmounts[i] > 0, "Hint zero");
                }
            } else {
                uint256 per = amount / uint256(numOutcomes);
                require(per > 0, "Per outcome");
                for (uint256 i = 0; i < uint256(numOutcomes); i++) {
                    poolAmounts[i] = per;
                }
            }
            funded = true;
        } else {
            require(distributionHint.length == 0, "No hint after seed");
            uint256 maxPool;
            for (uint256 i = 0; i < uint256(numOutcomes); i++) {
                if (poolBalances[i] > maxPool) maxPool = poolBalances[i];
            }
            require(maxPool > 0, "Pool empty");
            for (uint256 i = 0; i < uint256(numOutcomes); i++) {
                poolAmounts[i] = (amount * poolBalances[i]) / maxPool;
            }
        }

        for (uint256 i = 0; i < uint256(numOutcomes); i++) {
            poolBalances[i] += poolAmounts[i];
            _outcomeTokens[i].mint(address(this), poolAmounts[i]);
            uint256 returned = amount - poolAmounts[i];
            if (returned > 0) {
                _outcomeTokens[i].mint(shareRecipient, returned);
            }
        }

        emit FundingAdded(msg.sender, amount, poolAmounts);
    }

    function buy(uint8 outcomeIndex, uint256 investmentAmount, uint256 minOutcomeTokens) external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (state != MarketState.OPEN) revert MarketNotOpen();
        if (block.timestamp >= stakeEndTimestamp) revert StakePeriodEnded();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        if (investmentAmount < MIN_TRADE) revert ZeroAmount();
        if (!funded) revert InvalidState();

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), investmentAmount);

        uint256 creatorFee = (investmentAmount * CREATOR_FEE_BPS) / BPS_DENOMINATOR;
        uint256 protocolFee = (investmentAmount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = investmentAmount - creatorFee - protocolFee;
        if (creatorFee > 0) IERC20(collateralToken).safeTransfer(creator, creatorFee);
        if (protocolFee > 0) IERC20(collateralToken).safeTransfer(feeRecipient, protocolFee);

        uint256[] memory pools = poolBalances;
        uint256 tokensOut = ZedkrFpmmMath.calcBuyAmount(netAmount, outcomeIndex, pools, 0);
        if (tokensOut < minOutcomeTokens) revert Slippage();
        if (tokensOut == 0) revert ZeroAmount();

        _applyBuy(outcomeIndex, netAmount, tokensOut);
        _outcomeTokens[outcomeIndex].mint(msg.sender, tokensOut);

        emit FpmmBuy(
            msg.sender,
            outcomeIndex,
            investmentAmount,
            tokensOut,
            ZedkrFpmmMath.marginalPrice(poolBalances, outcomeIndex)
        );
    }

    function sell(uint8 outcomeIndex, uint256 returnAmount, uint256 maxOutcomeTokens) external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (state != MarketState.OPEN) revert MarketNotOpen();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        if (returnAmount < MIN_TRADE) revert ZeroAmount();
        if (!funded) revert InvalidState();

        uint256[] memory pools = poolBalances;
        uint256 tokensIn = ZedkrFpmmMath.calcSellAmount(returnAmount, outcomeIndex, pools, TRADE_FEE_TOTAL_BPS);
        if (tokensIn > maxOutcomeTokens) revert Slippage();
        if (tokensIn == 0) revert ZeroAmount();

        _outcomeTokens[outcomeIndex].burnFrom(msg.sender, tokensIn);
        _applySell(outcomeIndex, returnAmount, tokensIn);

        uint256 protocolFee = (returnAmount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 creatorFee = (returnAmount * CREATOR_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netReturn = returnAmount - protocolFee - creatorFee;
        if (creatorFee > 0) IERC20(collateralToken).safeTransfer(creator, creatorFee);
        if (protocolFee > 0) IERC20(collateralToken).safeTransfer(feeRecipient, protocolFee);
        IERC20(collateralToken).safeTransfer(msg.sender, netReturn);

        emit FpmmSell(msg.sender, outcomeIndex, returnAmount, tokensIn);
    }

    function settlePrice() external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (marketKind != MarketKind.PRICE) revert InvalidState();
        if (state != MarketState.OPEN) revert InvalidState();
        if (block.timestamp < resolveAfterTimestamp) revert TooEarlyToResolve();

        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) =
            IMondaloreAggregatorV3(chainlinkFeed).latestRoundData();
        require(answer > 0, "Answer");
        require(block.timestamp - updatedAt <= maxPriceStaleness, "Stale");
        require(answeredInRound >= roundId, "Stale round");

        uint8 dec = IMondaloreAggregatorV3(chainlinkFeed).decimals();
        uint256 normalized;
        if (dec >= 6) {
            normalized = uint256(answer) / (10 ** (dec - 6));
        } else {
            normalized = uint256(answer) * (10 ** (6 - dec));
        }

        _finalizeSettlement(_winningOutcomePrice(normalized), answer);
    }

    function resolveEvent(
        uint8 outcomeIndex,
        address[] calldata signers,
        bytes[] calldata signatures
    ) external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (marketKind != MarketKind.EVENT) revert InvalidState();
        if (state != MarketState.OPEN) revert InvalidState();
        if (block.timestamp < resolveAfterTimestamp) revert TooEarlyToResolve();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        if (signers.length != signatures.length || signers.length == 0) revert InvalidResolutionSignatures();

        IMondaloreMarketFactoryResolution fac = IMondaloreMarketFactoryResolution(factory);
        uint256 threshold = fac.resolutionThreshold();
        if (signers.length < threshold) revert InvalidResolutionSignatures();

        bytes32 digest = _eventResolutionDigest(outcomeIndex);
        uint256 valid;
        for (uint256 i = 0; i < signers.length; i++) {
            address signer = signers[i];
            if (!fac.isResolutionAdmin(signer)) revert InvalidResolutionSignatures();
            if (_recoverSigner(digest, signatures[i]) != signer) revert InvalidResolutionSignatures();
            for (uint256 j = 0; j < i; j++) {
                if (signers[j] == signer) revert InvalidResolutionSignatures();
            }
            valid++;
        }
        if (valid < threshold) revert InvalidResolutionSignatures();

        _finalizeSettlement(outcomeIndex, int256(uint256(outcomeIndex)));
        emit EventResolved(outcomeIndex, msg.sender, valid);
    }

    function resolvePonsToken(uint8 outcomeIndex) external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (marketKind != MarketKind.PONS_TOKEN) revert InvalidState();
        if (state != MarketState.OPEN) revert InvalidState();
        if (block.timestamp < resolveAfterTimestamp) revert TooEarlyToResolve();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        if (msg.sender != IMondaloreMarketFactoryResolution(factory).ponsResolutionAdmin()) {
            revert NotPonsResolutionAdmin();
        }

        _finalizeSettlement(outcomeIndex, int256(uint256(outcomeIndex)));
        emit PonsTokenResolved(outcomeIndex, msg.sender);
    }

    function redeem(uint8 outcomeIndex, uint256 shareAmount) external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (state != MarketState.SETTLED) revert InvalidState();
        if (shareAmount == 0) revert ZeroAmount();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        if (outcomeIndex != uint8(winningOutcomeIndex)) revert InvalidOutcome();
        if (redemptionRate == 0) revert InvalidState();

        uint256 payout = (shareAmount * redemptionRate) / FIXED_REDEMPTION_RATE;
        require(payout > 0, "Payout");
        require(IERC20(collateralToken).balanceOf(address(this)) >= payout, "Insolvent");

        _outcomeTokens[outcomeIndex].burnFrom(msg.sender, shareAmount);
        IERC20(collateralToken).safeTransfer(msg.sender, payout);
        emit TokensRedeemed(msg.sender, outcomeIndex, shareAmount, payout);
    }

    function _applyBuy(uint8 outcomeIndex, uint256 netAmount, uint256 tokensOut) internal {
        poolBalances[outcomeIndex] += netAmount;
        poolBalances[outcomeIndex] -= tokensOut;
        for (uint256 j = 0; j < uint256(numOutcomes); j++) {
            if (j != outcomeIndex) {
                poolBalances[j] += netAmount;
            }
        }
    }

    function _applySell(uint8 outcomeIndex, uint256 returnAmount, uint256 tokensIn) internal {
        poolBalances[outcomeIndex] += tokensIn;
        poolBalances[outcomeIndex] -= returnAmount;
        for (uint256 j = 0; j < uint256(numOutcomes); j++) {
            if (j != outcomeIndex) {
                poolBalances[j] -= returnAmount;
            }
        }
    }

    function _finalizeSettlement(uint256 winIdx, int256 oraclePrice) internal {
        winningOutcomeIndex = winIdx;
        settledOraclePrice = oraclePrice;
        settlementTimestamp = block.timestamp;
        state = MarketState.SETTLED;
        redemptionRate = FIXED_REDEMPTION_RATE;
        emit MarketSettled(winIdx);
    }

    function _winningOutcomePrice(uint256 normalizedPrice) internal view returns (uint256) {
        if (priceBinLower.length == uint256(numOutcomes)) {
            uint256 matches;
            uint256 win;
            for (uint256 i = 0; i < uint256(numOutcomes); i++) {
                if (normalizedPrice >= priceBinLower[i] && normalizedPrice <= priceBinUpper[i]) {
                    matches++;
                    win = i;
                }
            }
            require(matches == 1, "One bin");
            return win;
        }
        require(uint256(numOutcomes) == 2, "Bins");
        bool firstWins;
        if (priceThresholdKind == PriceThresholdKind.ABOVE) {
            firstWins = normalizedPrice >= priceThreshold;
        } else if (priceThresholdKind == PriceThresholdKind.BELOW) {
            firstWins = normalizedPrice <= priceThreshold;
        } else {
            firstWins = normalizedPrice >= priceThreshold && normalizedPrice <= priceUpperBound;
        }
        return firstWins ? 0 : 1;
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                EIP712_NAME_HASH,
                EIP712_VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function _eventResolutionDigest(uint8 outcomeIndex) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(EVENT_RESOLUTION_TYPEHASH, address(this), outcomeIndex, block.chainid)
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidResolutionSignatures();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidResolutionSignatures();
        return ecrecover(digest, v, r, s);
    }
}

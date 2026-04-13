// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../token/AFTROutcomeToken.sol";
import "../interfaces/IAFTRAggregatorV3.sol";
import "../interfaces/IAFTROptimisticOracleV2.sol";
import "../config/AFTRUmaIdentifiers.sol";

/// @title AFTRVParimutuelMarket
/// @notice vPari: virtual + real pricing; native ETH (collateral address(0)) or ERC20; multi-outcome PRICE via bins.
contract AFTRVParimutuelMarket is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Total fee taken from losing real pools (3%).
    uint256 public constant LOSER_FEE_TOTAL_BPS = 300;
    /// @notice Of that 3%, 0.5% of losers’ real collateral goes to the address that called `bootstrapLiquidity`.
    uint256 public constant BOOTSTRAP_FEE_BPS = 50;
    uint256 public constant UMA_BINARY_WIN_OUTCOME0 = 1e18;

    enum MarketKind {
        PRICE,
        EVENT
    }

    enum PriceThresholdKind {
        ABOVE,
        BELOW,
        IN_RANGE
    }

    enum MarketState {
        OPEN,
        AWAITING_UMA,
        SETTLED
    }

    address public immutable factory;
    address public immutable feeRecipient;
    /// @notice address(0) = native ETH (wei). Otherwise ERC20 collateral.
    address public immutable collateralAddress;
    uint8 public immutable collateralDecimals;
    uint8 public immutable numOutcomes;
    uint256 public immutable virtualReserve;
    uint256 public immutable stakeEndTimestamp;
    uint256 public immutable resolveAfterTimestamp;
    MarketKind public immutable marketKind;
    bytes32 public immutable metadataHash;

    address public immutable chainlinkFeed;
    uint256 public immutable priceThreshold;
    PriceThresholdKind public immutable priceThresholdKind;
    uint256 public immutable priceUpperBound;
    uint256 public immutable maxPriceStaleness;

    IAFTROptimisticOracleV2 public immutable optimisticOracleV2;
    bytes32 public immutable umaIdentifier;
    uint64 public immutable umaLiveness;
    /// @notice Extra OO proposer/disputer bond (wei of `umaRewardCurrency`), on top of protocol final fee. 0 = OO default only.
    uint256 public immutable umaProposerBond;
    uint256 public immutable umaReward;
    /// @notice UMA OO bond / reward currency — on Base testnet this is WETH. Separate from pool collateral.
    address public immutable umaRewardCurrency;
    /// @notice Minimum total collateral for the one-time permissionless `bootstrapLiquidity` (split evenly across outcomes).
    uint256 public immutable minBootstrapTotal;

    AFTROutcomeToken[] private _outcomeTokens;
    uint256[] public realPool;
    /// @notice If length == numOutcomes, PRICE settles by bin; else binary threshold mode (numOutcomes==2).
    uint256[] public priceBinLower;
    uint256[] public priceBinUpper;

    bool public initialized;
    MarketState public state;
    /// @notice Off-chain metadata location for the UI (e.g. `ipfs://bafy...` or gateway URL). Not sent to UMA.
    string public metadataURI;
    /// @notice Exact ancillary data bytes passed to OO `requestPrice` / `settleAndGetPrice` (UTF-8 question text or UMIP-specific encoding).
    bytes public umaAncillaryData;

    uint256 public umaRequestTimestamp;
    uint256 public winningOutcomeIndex;
    uint256 public redemptionRate;
    int256 public settledOraclePrice;
    uint256 public settlementTimestamp;

    /// @notice Set on first successful `bootstrapLiquidity`; receives BOOTSTRAP_FEE_BPS of losers at settlement.
    address public bootstrapFunder;
    bool public bootstrapped;

    uint256 private constant WIN_UNSET = type(uint256).max;

    event MarketInitialized(address[] outcomeTokens, string metadataURI, bytes umaAncillaryData);
    event Deposited(
        address indexed buyer,
        address indexed recipient,
        uint8 indexed outcomeIndex,
        uint256 collateralAmount,
        uint256 sharesMinted,
        uint256 price1e18
    );
    event MarketSettled(uint256 winningOutcomeIndex, uint256 feeFromLosers, uint256 distributableToWinners);
    event TokensRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout);
    event UmaResolutionRequested(uint256 timestamp, bytes ancillaryData, uint256 reward);
    event UmaBondFunded(address indexed from, address indexed currency, uint256 amount);
    event LiquidityBootstrapped(
        address indexed funder,
        address indexed shareRecipient,
        uint256 totalAmount,
        uint256 perOutcome
    );

    error OnlyFactory();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidOutcome();
    error StakePeriodEnded();
    error TooEarlyToResolve();
    error MarketNotOpen();
    error InvalidState();
    error ZeroShares();
    error Slippage();
    error NoRedemption();
    error EthAmount();
    error UnexpectedEth();
    error NotEventMarket();
    error AlreadyBootstrapped();
    error BelowMinBootstrap();
    error NotDivisibleBootstrap();
    error InvalidShareRecipient();
    /// @notice UMA settled to type(int256).min (too early) or type(int256).max (no answer) per UMIP-181 / OO conventions.
    error UmaInvalidResolution();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(
        address factory_,
        address owner_,
        address feeRecipient_,
        address collateralAddress_,
        uint8 collateralDecimals_,
        uint8 numOutcomes_,
        uint256 virtualReserve_,
        uint256 stakeEndTimestamp_,
        uint256 resolveAfterTimestamp_,
        MarketKind kind_,
        bytes32 metadataHash_,
        address chainlinkFeed_,
        uint256 priceThreshold_,
        PriceThresholdKind priceKind_,
        uint256 priceUpperBound_,
        uint256 maxPriceStaleness_,
        address optimisticOracleV2_,
        bytes32 umaIdentifier_,
        uint64 umaLiveness_,
        uint256 umaProposerBond_,
        uint256 umaReward_,
        address umaRewardCurrency_,
        uint256 minBootstrapTotal_
    ) Ownable(owner_) {
        require(factory_ != address(0) && owner_ != address(0) && feeRecipient_ != address(0), "Zero address");
        require(numOutcomes_ >= 2 && numOutcomes_ <= 32, "Outcomes range");
        require(virtualReserve_ > 0, "Virtual reserve");
        require(stakeEndTimestamp_ > block.timestamp, "Stake end past");
        require(resolveAfterTimestamp_ > stakeEndTimestamp_, "Resolve order");
        require(metadataHash_ != bytes32(0), "Metadata");
        if (collateralAddress_ == address(0)) {
            require(collateralDecimals_ == 18, "ETH 18 dec");
        }

        factory = factory_;
        feeRecipient = feeRecipient_;
        collateralAddress = collateralAddress_;
        collateralDecimals = collateralDecimals_;
        numOutcomes = numOutcomes_;
        virtualReserve = virtualReserve_;
        stakeEndTimestamp = stakeEndTimestamp_;
        resolveAfterTimestamp = resolveAfterTimestamp_;
        marketKind = kind_;
        metadataHash = metadataHash_;

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
            optimisticOracleV2 = IAFTROptimisticOracleV2(address(0));
            umaIdentifier = bytes32(0);
            umaLiveness = 0;
            umaProposerBond = 0;
            umaReward = 0;
            umaRewardCurrency = address(0);
        } else {
            require(optimisticOracleV2_ != address(0), "OOv2");
            require(umaIdentifier_ != bytes32(0), "UMA id");
            require(umaLiveness_ > 0, "Liveness");
            require(umaRewardCurrency_ != address(0), "UMA currency");
            chainlinkFeed = address(0);
            priceThreshold = 0;
            priceThresholdKind = PriceThresholdKind.ABOVE;
            priceUpperBound = 0;
            maxPriceStaleness = 0;
            optimisticOracleV2 = IAFTROptimisticOracleV2(optimisticOracleV2_);
            umaIdentifier = umaIdentifier_;
            umaLiveness = umaLiveness_;
            umaProposerBond = umaProposerBond_;
            umaReward = umaReward_;
            umaRewardCurrency = umaRewardCurrency_;
        }

        minBootstrapTotal = minBootstrapTotal_;
        winningOutcomeIndex = WIN_UNSET;
    }

    function initialize(
        address[] calldata outcomeTokenAddresses,
        uint256[] calldata binLower,
        uint256[] calldata binUpper,
        string calldata metadataURI_,
        bytes calldata umaAncillaryData_
    ) external onlyFactory {
        if (initialized) revert AlreadyInitialized();
        require(outcomeTokenAddresses.length == uint256(numOutcomes), "Token count");
        initialized = true;

        for (uint256 i = 0; i < outcomeTokenAddresses.length; i++) {
            _outcomeTokens.push(AFTROutcomeToken(outcomeTokenAddresses[i]));
            realPool.push(0);
        }

        if (marketKind == MarketKind.PRICE) {
            if (binLower.length > 0) {
                require(binLower.length == uint256(numOutcomes) && binUpper.length == uint256(numOutcomes), "Bins");
                for (uint256 i = 0; i < binLower.length; i++) {
                    require(binLower[i] <= binUpper[i], "Bin bounds");
                    priceBinLower.push(binLower[i]);
                    priceBinUpper.push(binUpper[i]);
                }
            } else {
                require(uint256(numOutcomes) == 2, "Bins or N=2");
            }
            require(umaAncillaryData_.length == 0, "No UMA anc");
        }

        metadataURI = metadataURI_;

        if (marketKind == MarketKind.EVENT) {
            require(umaAncillaryData_.length > 0, "UMA anc");
            require(umaAncillaryData_.length <= 8192, "Ancillary len");
            umaAncillaryData = umaAncillaryData_;
        }

        emit MarketInitialized(outcomeTokenAddresses, metadataURI_, umaAncillaryData_);
    }

    function outcomeToken(uint256 index) external view returns (address) {
        return address(_outcomeTokens[index]);
    }

    function priceOf(uint8 outcomeIndex) public view returns (uint256) {
        if (!initialized) revert NotInitialized();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        uint256 totalWeight;
        for (uint256 j = 0; j < uint256(numOutcomes); j++) {
            totalWeight += virtualReserve + realPool[j];
        }
        require(totalWeight > 0, "Weight");
        return ((virtualReserve + realPool[outcomeIndex]) * 1e18) / totalWeight;
    }

    receive() external payable {}

    function deposit(uint8 outcomeIndex, uint256 amount, address recipient, uint256 minSharesOut) external payable nonReentrant {
        if (!initialized) revert NotInitialized();
        if (state != MarketState.OPEN) revert MarketNotOpen();
        if (block.timestamp >= stakeEndTimestamp) revert StakePeriodEnded();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        require(amount > 0, "Amount");
        require(recipient != address(0), "Recipient");

        if (collateralAddress == address(0)) {
            if (msg.value != amount) revert EthAmount();
        } else {
            require(msg.value == 0, "No ETH");
            IERC20(collateralAddress).safeTransferFrom(msg.sender, address(this), amount);
        }

        uint256 p = priceOf(outcomeIndex);
        require(p > 0, "Price");
        uint256 shares = (amount * 1e18) / p;
        if (shares == 0) revert ZeroShares();
        if (shares < minSharesOut) revert Slippage();

        realPool[outcomeIndex] += amount;
        _outcomeTokens[outcomeIndex].mint(recipient, shares);

        emit Deposited(msg.sender, recipient, outcomeIndex, amount, shares, p);
    }

    /// @notice One-time permissionless seed: split `totalAmount` evenly across all outcomes, mint shares to `shareRecipient`.
    /// @dev Caller becomes `bootstrapFunder` and earns BOOTSTRAP_FEE_BPS of the losing side at settlement (0.5% of losers); protocol keeps PROTOCOL_FEE_BPS (2.5%).
    function bootstrapLiquidity(uint256 totalAmount, address shareRecipient) external payable nonReentrant {
        if (!initialized) revert NotInitialized();
        if (state != MarketState.OPEN) revert MarketNotOpen();
        if (block.timestamp >= stakeEndTimestamp) revert StakePeriodEnded();
        if (bootstrapped) revert AlreadyBootstrapped();
        if (shareRecipient == address(0)) revert InvalidShareRecipient();
        if (totalAmount == 0 || totalAmount < minBootstrapTotal) revert BelowMinBootstrap();

        uint256 n = uint256(numOutcomes);
        if (totalAmount % n != 0) revert NotDivisibleBootstrap();
        uint256 per = totalAmount / n;

        if (collateralAddress == address(0)) {
            if (msg.value != totalAmount) revert EthAmount();
        } else {
            if (msg.value != 0) revert UnexpectedEth();
            IERC20(collateralAddress).safeTransferFrom(msg.sender, address(this), totalAmount);
        }

        for (uint8 i = 0; i < numOutcomes; i++) {
            uint256 p = priceOf(i);
            require(p > 0, "Price");
            uint256 shares = (per * 1e18) / p;
            if (shares == 0) revert ZeroShares();
            realPool[i] += per;
            _outcomeTokens[i].mint(shareRecipient, shares);
            emit Deposited(msg.sender, shareRecipient, i, per, shares, p);
        }

        bootstrapFunder = msg.sender;
        bootstrapped = true;
        emit LiquidityBootstrapped(msg.sender, shareRecipient, totalAmount, per);
    }

    /// @notice Pull WETH (or whatever `umaRewardCurrency` is) into the market so `requestEventResolution` can bond UMA.
    function fundUmaBond(uint256 amount) external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (marketKind != MarketKind.EVENT) revert NotEventMarket();
        require(amount > 0, "Amount");
        IERC20(umaRewardCurrency).safeTransferFrom(msg.sender, address(this), amount);
        emit UmaBondFunded(msg.sender, umaRewardCurrency, amount);
    }

    function settlePrice() external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (marketKind != MarketKind.PRICE) revert InvalidState();
        if (state != MarketState.OPEN) revert InvalidState();
        if (block.timestamp < resolveAfterTimestamp) revert TooEarlyToResolve();

        (, int256 answer, , uint256 updatedAt, ) = IAFTRAggregatorV3(chainlinkFeed).latestRoundData();
        require(answer > 0, "Answer");
        require(block.timestamp - updatedAt <= maxPriceStaleness, "Stale");

        uint8 dec = IAFTRAggregatorV3(chainlinkFeed).decimals();
        uint256 normalized;
        if (dec >= 6) {
            normalized = uint256(answer) / (10 ** (dec - 6));
        } else {
            normalized = uint256(answer) * (10 ** (6 - dec));
        }

        uint256 winIdx = _winningOutcomePrice(normalized);
        _finalizeSettlement(winIdx, answer);
    }

    function requestEventResolution() external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (marketKind != MarketKind.EVENT) revert InvalidState();
        if (state != MarketState.OPEN) revert InvalidState();
        if (block.timestamp < resolveAfterTimestamp) revert TooEarlyToResolve();

        bytes memory ancillary = umaAncillaryData;
        uint256 ts = block.timestamp;
        umaRequestTimestamp = ts;

        if (umaReward > 0) {
            IERC20(umaRewardCurrency).forceApprove(address(optimisticOracleV2), umaReward);
        }

        // Uses immutables: identifier, reward, liveness, bond — caller passes nothing.
        optimisticOracleV2.requestPrice(umaIdentifier, ts, ancillary, umaRewardCurrency, umaReward);
        // Event-based OO flow (UMA dev tutorial): custom liveness, optional bond, then event-based flags.
        optimisticOracleV2.setCustomLiveness(umaIdentifier, ts, ancillary, uint256(umaLiveness));
        if (umaProposerBond > 0) {
            optimisticOracleV2.setBond(umaIdentifier, ts, ancillary, umaProposerBond);
        }
        optimisticOracleV2.setEventBased(umaIdentifier, ts, ancillary);
        // No setCallbacks: we do not implement OO callbacks; settlement is pull-based via `settleWithUmaResult`.

        state = MarketState.AWAITING_UMA;

        emit UmaResolutionRequested(ts, ancillary, umaReward);
    }

    function settleWithUmaResult() external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (marketKind != MarketKind.EVENT) revert InvalidState();
        if (state != MarketState.AWAITING_UMA) revert InvalidState();

        bytes memory ancillary = umaAncillaryData;
        int256 price = optimisticOracleV2.settleAndGetPrice(umaIdentifier, umaRequestTimestamp, ancillary);

        uint256 winIdx = _winningOutcomeFromUma(price);
        _finalizeSettlement(winIdx, price);
    }

    function redeem(uint8 outcomeIndex, uint256 shareAmount) external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (state != MarketState.SETTLED) revert InvalidState();
        if (shareAmount == 0) revert ZeroShares();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        if (outcomeIndex != uint8(winningOutcomeIndex)) revert InvalidOutcome();
        if (redemptionRate == 0) revert NoRedemption();

        uint256 payout = (shareAmount * redemptionRate) / 1e18;
        require(payout > 0, "Payout");

        _outcomeTokens[outcomeIndex].burnFrom(msg.sender, shareAmount);
        _sendCollateral(msg.sender, payout);
    }

    function _sendCollateral(address to, uint256 amount) private {
        if (collateralAddress == address(0)) {
            Address.sendValue(payable(to), amount);
        } else {
            IERC20(collateralAddress).safeTransfer(to, amount);
        }
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

    function _winningOutcomeFromUma(int256 price) internal view returns (uint256) {
        if (price == type(int256).min || price == type(int256).max) {
            revert UmaInvalidResolution();
        }

        // UMIP-181: option values are int256 “as specified in ancillary” — we require 0 .. numOutcomes-1 on-chain.
        if (umaIdentifier == AFTRUmaIdentifiers.MULTIPLE_CHOICE_QUERY) {
            if (price < 0) revert UmaInvalidResolution();
            uint256 v = uint256(price);
            if (v >= uint256(numOutcomes)) revert UmaInvalidResolution();
            return v;
        }

        // YES_OR_NO_QUERY (UMIP): yes = 1e18 → outcome 0; otherwise outcome 1 (binary only at factory).
        if (umaIdentifier == AFTRUmaIdentifiers.YES_OR_NO_QUERY) {
            if (price == int256(UMA_BINARY_WIN_OUTCOME0)) return 0;
            return 1;
        }

        // Custom identifier: binary-style 1e18, or non-negative index / scaled index.
        if (numOutcomes == 2) {
            if (price == int256(UMA_BINARY_WIN_OUTCOME0)) return 0;
            return 1;
        }
        if (price < 0) revert UmaInvalidResolution();
        uint256 u2 = uint256(price);
        uint256 idx2 = u2 >= 1e18 ? u2 / 1e18 : u2;
        if (idx2 >= uint256(numOutcomes)) revert UmaInvalidResolution();
        return idx2;
    }

    function _finalizeSettlement(uint256 winIdx, int256 oraclePrice) internal {
        uint256 losersReal;
        for (uint256 j = 0; j < uint256(numOutcomes); j++) {
            if (j != winIdx) {
                losersReal += realPool[j];
            }
        }

        uint256 totalFee = (losersReal * LOSER_FEE_TOTAL_BPS) / BPS_DENOMINATOR;
        uint256 feeBootstrap = (losersReal * BOOTSTRAP_FEE_BPS) / BPS_DENOMINATOR;
        uint256 feeProtocol = totalFee - feeBootstrap;
        uint256 distributable = losersReal - totalFee;

        uint256 winSupply = _outcomeTokens[winIdx].totalSupply();
        uint256 winReal = realPool[winIdx];

        if (totalFee > 0) {
            if (bootstrapFunder != address(0) && feeBootstrap > 0) {
                _sendCollateral(bootstrapFunder, feeBootstrap);
                _sendCollateral(feeRecipient, feeProtocol);
            } else {
                _sendCollateral(feeRecipient, totalFee);
            }
        }

        if (winSupply > 0) {
            redemptionRate = ((winReal + distributable) * 1e18) / winSupply;
        } else {
            redemptionRate = 0;
            uint256 residue = winReal + distributable;
            if (residue > 0) {
                _sendCollateral(feeRecipient, residue);
            }
        }

        winningOutcomeIndex = winIdx;
        settledOraclePrice = oraclePrice;
        settlementTimestamp = block.timestamp;
        state = MarketState.SETTLED;

        emit MarketSettled(winIdx, totalFee, distributable);
    }
}

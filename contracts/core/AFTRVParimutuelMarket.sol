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
import "../interfaces/IAFTRFeeReceiver.sol";
import "../config/AFTRUmaIdentifiers.sol";

interface IDRPDebtRepay {
    function usdead() external view returns (address);
    function repayDebt(address user, address token, uint256 amountDebtToBurn) external;
}

/// @title AFTRVParimutuelMarket
/// @notice vPari: virtual + real pricing; native ETH (collateral address(0)) or ERC20; multi-outcome PRICE via bins.
contract AFTRVParimutuelMarket is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Total fee taken from each trade (1.5%).
    uint256 public constant TRADE_FEE_TOTAL_BPS = 150;
    /// @notice Of the 1.5% trade fee, 0.3% goes to the market creator.
    uint256 public constant CREATOR_FEE_BPS = 30;
    /// @notice Remaining 1.2% goes to the protocol fee recipient.
    uint256 public constant PROTOCOL_FEE_BPS = 120;
    uint256 public constant UMA_BINARY_WIN_OUTCOME0 = 1e18;
    /// @notice Minimum deposit to ensure fees are non-zero (> 10_000 / 30 = 334 wei).
    uint256 public constant MIN_DEPOSIT = 1000;

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
    /// @notice The address that created this market via the factory; receives CREATOR_FEE_BPS of each trade.
    address public immutable creator;
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
    /// @notice UMA OO bond / reward currency. Separate from pool collateral.
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

    address public bootstrapFunder;
    bool public bootstrapped;

    /// @notice Collateral claimable by feeRecipient when a market settles with zero winning shares.
    /// @dev Pull pattern — avoids DoS if feeRecipient is a reverting contract.
    uint256 public unclaimedResidue;

    /// @notice Whitelisted DRP contract addresses for redeemAndRepayDebt.
    mapping(address => bool) public isApprovedDrp;

    uint256 private constant WIN_UNSET = type(uint256).max;

    event MarketInitialized(address[] outcomeTokens, string metadataURI, bytes umaAncillaryData);
    event Deposited(
        address indexed buyer,
        address indexed recipient,
        uint8 indexed outcomeIndex,
        uint256 collateralAmount,
        uint256 sharesMinted,
        uint256 price1e18,
        uint256 timestamp
    );
    event MarketSettled(uint256 winningOutcomeIndex, uint256 distributableToWinners);
    event ResidueAccrued(uint256 amount);
    event ResidueClaimed(address indexed to, uint256 amount);
    event DrpApproved(address indexed drp);
    event DrpRevoked(address indexed drp);
    event TokensRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout);
    event TokensRedeemedAndDebtRepayAttempted(
        address indexed user,
        uint8 indexed outcomeIndex,
        uint256 shares,
        uint256 payout,
        address indexed drp,
        address vaultCollateralToken,
        uint256 debtRequestedToBurn
    );
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
    error InvalidDrp();
    error InvalidDebtRepayToken();
    error InvalidDrpAddress();
    error BelowMinDeposit();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(
        address factory_,
        address owner_,
        address feeRecipient_,
        address creator_,
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
        require(creator_ != address(0), "Zero creator");
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
        creator = creator_;
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

    /// @notice Owner approves a DRP contract for use in redeemAndRepayDebt.
    /// @dev Fix #5: whitelist valid DRP addresses instead of accepting any user-supplied address.
    function approveDrp(address drp) external onlyOwner {
        require(drp != address(0), "Zero drp");
        isApprovedDrp[drp] = true;
        emit DrpApproved(drp);
    }

    function revokeDrp(address drp) external onlyOwner {
        isApprovedDrp[drp] = false;
        emit DrpRevoked(drp);
    }

    /// @notice Claim residue collateral that accrued when a market settled with zero winning shares.
    /// @dev Fix #4: pull pattern — feeRecipient calls this instead of receiving a push during settlement.
    function claimResidue() external nonReentrant {
        uint256 amount = unclaimedResidue;
        require(amount > 0, "No residue");
        unclaimedResidue = 0;
        _sendCollateral(feeRecipient, amount);
        emit ResidueClaimed(feeRecipient, amount);
    }

    /// @notice Fix #7: After all winners have redeemed, sweep any rounding dust to feeRecipient.
    /// @dev Double floor-division in redemptionRate * shares / 1e18 leaves up to (winSupply-1)/1e18
    ///      wei permanently locked. Owner can sweep this after the market is fully settled.
    function sweepDust() external onlyOwner nonReentrant {
        require(state == MarketState.SETTLED, "Not settled");
        uint256 winIdx = winningOutcomeIndex;
        require(winIdx != WIN_UNSET, "Not settled");
        // Any remaining balance beyond what's owed to outstanding shares is dust.
        uint256 outstanding = (_outcomeTokens[winIdx].totalSupply() * redemptionRate) / 1e18;
        uint256 bal;
        if (collateralAddress == address(0)) {
            bal = address(this).balance;
        } else {
            bal = IERC20(collateralAddress).balanceOf(address(this));
        }
        // Subtract unclaimed residue so we don't double-count.
        uint256 available = bal > unclaimedResidue ? bal - unclaimedResidue : 0;
        uint256 dust = available > outstanding ? available - outstanding : 0;
        if (dust > 0) {
            _sendCollateral(feeRecipient, dust);
            emit ResidueClaimed(feeRecipient, dust);
        }
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
        // Fix #6: enforce minimum deposit so fee calculations never truncate to zero.
        require(amount >= MIN_DEPOSIT, "Below min deposit");
        require(recipient != address(0), "Recipient");

        if (collateralAddress == address(0)) {
            if (msg.value != amount) revert EthAmount();
        } else {
            require(msg.value == 0, "No ETH");
            IERC20(collateralAddress).safeTransferFrom(msg.sender, address(this), amount);
        }

        // Deduct 1.5% trade fee: 0.3% to creator, 1.2% to protocol fee recipient.
        uint256 creatorFee = (amount * CREATOR_FEE_BPS) / BPS_DENOMINATOR;
        uint256 protocolFee = (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = amount - creatorFee - protocolFee;

        if (creatorFee > 0) _sendCollateral(creator, creatorFee);
        if (protocolFee > 0) _sendProtocolFee(protocolFee);

        uint256 p = priceOf(outcomeIndex);
        require(p > 0, "Price");
        uint256 shares = (netAmount * 1e18) / p;
        if (shares == 0) revert ZeroShares();
        if (shares < minSharesOut) revert Slippage();

        realPool[outcomeIndex] += netAmount;
        _outcomeTokens[outcomeIndex].mint(recipient, shares);

        emit Deposited(msg.sender, recipient, outcomeIndex, amount, shares, p, block.timestamp);
    }

    /// @notice One-time permissionless seed: split `totalAmount` evenly across all outcomes, mint shares to `shareRecipient`.
    /// @dev Bootstrap liquidity is exempt from trade fees to ensure fair seeding.
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

        // Fix #1: Snapshot all prices BEFORE any pool update so every outcome
        // gets shares computed at the same pre-bootstrap price, preventing
        // later outcomes from receiving more shares due to growing totalWeight.
        uint256[] memory prices = new uint256[](uint256(numOutcomes));
        for (uint8 i = 0; i < numOutcomes; i++) {
            prices[i] = priceOf(i);
            require(prices[i] > 0, "Price");
        }

        for (uint8 i = 0; i < numOutcomes; i++) {
            uint256 shares = (per * 1e18) / prices[i];
            if (shares == 0) revert ZeroShares();
            realPool[i] += per;
            _outcomeTokens[i].mint(shareRecipient, shares);
            emit Deposited(msg.sender, shareRecipient, i, per, shares, prices[i], block.timestamp);
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

        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = IAFTRAggregatorV3(chainlinkFeed).latestRoundData();
        require(answer > 0, "Answer");
        require(block.timestamp - updatedAt <= maxPriceStaleness, "Stale");
        // Fix #3: guard against a completed round that carries a stale answer from a prior round.
        require(answeredInRound >= roundId, "Stale round");

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

        emit TokensRedeemed(msg.sender, outcomeIndex, shareAmount, payout);
    }

    /// @notice Redeem winning shares, then attempt DRP debt repayment in the same tx.
    /// @dev Requires market collateral to be USDeAD and DRP manager permissions configured for this market.
    function redeemAndRepayDebt(
        uint8 outcomeIndex,
        uint256 shareAmount,
        address drp,
        address vaultCollateralToken,
        uint256 debtToBurn
    ) external nonReentrant {
        if (!initialized) revert NotInitialized();
        if (state != MarketState.SETTLED) revert InvalidState();
        if (shareAmount == 0) revert ZeroShares();
        if (outcomeIndex >= numOutcomes) revert InvalidOutcome();
        if (outcomeIndex != uint8(winningOutcomeIndex)) revert InvalidOutcome();
        if (redemptionRate == 0) revert NoRedemption();
        if (drp == address(0)) revert InvalidDrp();
        // Fix #5: only allow whitelisted DRP addresses — prevents malicious user-supplied drp.
        if (!isApprovedDrp[drp]) revert InvalidDrpAddress();

        if (collateralAddress == address(0) || collateralAddress != IDRPDebtRepay(drp).usdead()) {
            revert InvalidDebtRepayToken();
        }

        uint256 payout = (shareAmount * redemptionRate) / 1e18;
        require(payout > 0, "Payout");

        _outcomeTokens[outcomeIndex].burnFrom(msg.sender, shareAmount);
        _sendCollateral(msg.sender, payout);

        IDRPDebtRepay(drp).repayDebt(msg.sender, vaultCollateralToken, debtToBurn);

        emit TokensRedeemed(msg.sender, outcomeIndex, shareAmount, payout);
        emit TokensRedeemedAndDebtRepayAttempted(
            msg.sender,
            outcomeIndex,
            shareAmount,
            payout,
            drp,
            vaultCollateralToken,
            debtToBurn
        );
    }

    function _sendCollateral(address to, uint256 amount) private {
        if (collateralAddress == address(0)) {
            Address.sendValue(payable(to), amount);
        } else {
            IERC20(collateralAddress).safeTransfer(to, amount);
        }
    }

    /// @dev Send protocol fees to feeRecipient. If feeRecipient implements IAFTRFeeReceiver,
    ///      call receiveFees() so the vault accumulator updates atomically.
    ///      Falls back to a plain transfer for non-vault recipients.
    function _sendProtocolFee(uint256 amount) private {
        if (amount == 0) return;
        // Check if feeRecipient implements the vault hook (low-level staticcall to avoid revert on EOA).
        bool isVault = _supportsReceiveFees(feeRecipient);
        if (isVault) {
            if (collateralAddress == address(0)) {
                IAFTRFeeReceiver(feeRecipient).receiveFees{value: amount}(address(0), amount);
            } else {
                IERC20(collateralAddress).forceApprove(feeRecipient, amount);
                IAFTRFeeReceiver(feeRecipient).receiveFees(collateralAddress, amount);
            }
        } else {
            _sendCollateral(feeRecipient, amount);
        }
    }

    /// @dev Returns true if `target` has code and responds to the IAFTRFeeReceiver selector.
    function _supportsReceiveFees(address target) private view returns (bool) {
        if (target.code.length == 0) return false;
        // ERC165-style check: call supportsInterface(IAFTRFeeReceiver.receiveFees.selector)
        // We use a simpler approach: check for a known 4-byte selector via staticcall.
        (bool ok, bytes memory ret) = target.staticcall(
            abi.encodeWithSignature("supportsInterface(bytes4)", type(IAFTRFeeReceiver).interfaceId)
        );
        return ok && ret.length == 32 && abi.decode(ret, (bool));
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

        // UMIP-181: option values are int256 "as specified in ancillary" — we require 0 .. numOutcomes-1 on-chain.
        if (umaIdentifier == AFTRUmaIdentifiers.MULTIPLE_CHOICE_QUERY) {
            if (price < 0) revert UmaInvalidResolution();
            uint256 v = uint256(price);
            if (v >= uint256(numOutcomes)) revert UmaInvalidResolution();
            return v;
        }

        // YES_OR_NO_QUERY (UMIP): yes = 1e18 -> outcome 0; otherwise outcome 1 (binary only at factory).
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
        uint256 winSupply = _outcomeTokens[winIdx].totalSupply();
        uint256 winReal = realPool[winIdx];

        // All loser pool collateral goes directly to winners (fees were already collected per-trade).
        uint256 distributable = 0;
        for (uint256 j = 0; j < uint256(numOutcomes); j++) {
            if (j != winIdx) {
                distributable += realPool[j];
            }
        }

        if (winSupply > 0) {
            redemptionRate = ((winReal + distributable) * 1e18) / winSupply;
        } else {
            // Fix #4: Use pull pattern instead of push to avoid DoS if feeRecipient reverts.
            // Residue is stored and claimable by feeRecipient via claimResidue().
            redemptionRate = 0;
            uint256 residue = winReal + distributable;
            if (residue > 0) {
                unclaimedResidue += residue;
                emit ResidueAccrued(residue);
            }
        }

        winningOutcomeIndex = winIdx;
        settledOraclePrice = oraclePrice;
        settlementTimestamp = block.timestamp;
        state = MarketState.SETTLED;

        emit MarketSettled(winIdx, distributable);
    }
}

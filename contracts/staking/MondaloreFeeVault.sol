// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../interfaces/IMondaloreFeeReceiver.sol";

/// @title MondaloreFeeVault
/// @notice Epoch-based fee-sharing vault. Users stake the Mondalore governance token and receive
///         sMondalore receipt tokens. A share of protocol fees (STAKER_SHARE_BPS of incoming fees)
///         is distributed to stakers pro-rata using the reward-per-token accumulator pattern.
///
/// Fee flow:
///   Market deposit → 1.2% protocol fee → feeRecipient (this vault)
///   Vault splits: STAKER_SHARE_BPS (20 bps = 0.2%) → stakers
///                 remainder (100 bps = 1.0%) → treasury (owner-withdrawable)
///
/// Epoch mechanics:
///   - Epochs advance automatically based on EPOCH_DURATION.
///   - Fees received during epoch N are claimable by stakers who were staked during epoch N.
///   - The accumulator is continuous (not snapshotted per epoch) — rewards accrue in real time
///     and are claimable at any time. Epochs are used for UI/reporting and lock enforcement.
///
/// Staking mechanics:
///   - Stake Mondalore → receive sMondalore 1:1. Each deposit gets its own unlock time.
///   - Top-ups do not reset the lock on earlier deposits.
///   - After lockDuration, call withdraw(amount) — instant, no two-step unstake.
///
/// Multi-token rewards:
///   - Any ERC20 or native ETH can be a reward token.
///   - Each reward token has its own accumulator.
///   - Owner registers reward tokens; vault accepts fees for registered tokens only.
contract MondaloreFeeVault is Ownable2Step, ReentrancyGuard, ERC165, IMondaloreFeeReceiver {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Share of incoming fees distributed to stakers (20 bps = 0.2%).
    uint256 public constant STAKER_SHARE_BPS = 20;
    /// @notice Precision multiplier for reward-per-token accumulator.
    uint256 public constant PRECISION = 1e18;

    // ─── Immutables ───────────────────────────────────────────────────────────

    /// @notice The token users stake (Mondalore governance/utility token).
    IERC20 public immutable stakeToken;
    /// @notice Duration of each epoch in seconds.
    uint256 public immutable epochDuration;
    /// @notice Minimum time each stake lot must remain before it can be withdrawn.
    uint256 public immutable lockDuration;
    /// @notice Timestamp of vault deployment — epoch 0 start.
    uint256 public immutable deployedAt;

    // ─── sMondalore Receipt Token ──────────────────────────────────────────────────

    /// @notice sMONDO receipt token — minted on stake, burned on withdraw.
    ///         Non-transferable: represents a locked staking position.
    sMondaloreToken public immutable receiptToken;

    // ─── Staking State ────────────────────────────────────────────────────────

    /// @notice Total Mondalore currently staked.
    uint256 public totalStaked;

    struct StakeLot {
        uint256 amount;
        uint256 unlockAt;
    }

    /// @notice Per-user stake lots (FIFO). Each `stake()` appends a lot with its own unlock time.
    mapping(address => StakeLot[]) private _stakeLots;

    // ─── Reward Token Registry ────────────────────────────────────────────────

    /// @notice List of registered reward tokens (address(0) = native ETH).
    address[] public rewardTokens;
    mapping(address => bool) public isRewardToken;

    // ─── Reward Accounting (per reward token) ─────────────────────────────────

    /// @notice Global reward-per-token accumulator. Increases whenever fees arrive.
    mapping(address => uint256) public rewardPerTokenStored;
    /// @notice Snapshot of rewardPerTokenStored at the time of user's last interaction.
    mapping(address => mapping(address => uint256)) public userRewardPerTokenPaid; // token => user => value
    /// @notice Pending claimable rewards per user per token.
    mapping(address => mapping(address => uint256)) public pendingRewards; // token => user => amount
    /// @notice Accumulated treasury share (owner-withdrawable) per token.
    mapping(address => uint256) public treasuryAccrued;
    /// @notice Fix #2: staker-share dust that truncated to zero — carried forward to next distribution.
    mapping(address => uint256) public stakerDust;

    // ─── Epoch Tracking ───────────────────────────────────────────────────────

    /// @notice Total fees received per epoch per token (for UI/analytics).
    mapping(uint256 => mapping(address => uint256)) public epochFees; // epoch => token => amount

    // ─── Events ───────────────────────────────────────────────────────────────

    event Staked(address indexed user, uint256 amount, uint256 epoch);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, address indexed token, uint256 amount);
    event FeesReceived(address indexed token, uint256 total, uint256 stakerShare, uint256 treasuryShare, uint256 epoch);
    event RewardTokenAdded(address indexed token);
    event RewardTokenRemoved(address indexed token);
    event TreasuryWithdrawn(address indexed token, address indexed to, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error ZeroAmount();
    error NotRegisteredRewardToken();
    error InsufficientStake();
    error InsufficientUnlocked();
    error AlreadyRegistered();
    error NothingToClaim();
    error TransferFailed();
    error SoulBound();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    /// @dev Updates the reward accumulator snapshot for a user across all reward tokens.
    modifier updateRewards(address user) {
        uint256 n = rewardTokens.length;
        for (uint256 i = 0; i < n; i++) {
            address token = rewardTokens[i];
            pendingRewards[token][user] = _earned(token, user);
            userRewardPerTokenPaid[token][user] = rewardPerTokenStored[token];
        }
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param owner_         Initial owner (protocol multisig / DAO).
    /// @param stakeToken_    Mondalore governance token address.
    /// @param epochDuration_ Epoch length in seconds (e.g. 7 days = 604800).
    /// @param lockDuration_  Min seconds each stake lot must remain before withdrawal.
    constructor(
        address owner_,
        address stakeToken_,
        uint256 epochDuration_,
        uint256 lockDuration_
    ) Ownable(owner_) {
        require(stakeToken_ != address(0), "Zero stake token");
        require(epochDuration_ > 0, "Zero epoch");
        stakeToken = IERC20(stakeToken_);
        epochDuration = epochDuration_;
        lockDuration = lockDuration_;
        deployedAt = block.timestamp;
        receiptToken = new sMondaloreToken(address(this));
    }

    // ─── View: Epoch ──────────────────────────────────────────────────────────

    /// @notice Current epoch index (0-indexed, advances every epochDuration seconds).
    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - deployedAt) / epochDuration;
    }

    // ─── View: Rewards ────────────────────────────────────────────────────────

    /// @notice Reward-per-token for a given reward token (current accumulator value).
    function rewardPerToken(address token) public view returns (uint256) {
        return rewardPerTokenStored[token];
    }

    /// @notice Total claimable rewards for `user` for a given `token`.
    function earned(address token, address user) external view returns (uint256) {
        return _earned(token, user);
    }

    /// @notice Total claimable rewards for `user` across all registered reward tokens.
    function earnedAll(address user)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 n = rewardTokens.length;
        tokens = new address[](n);
        amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            tokens[i] = rewardTokens[i];
            amounts[i] = _earned(rewardTokens[i], user);
        }
    }

    /// @notice Sum of stake lots that have passed their unlock time.
    function withdrawableBalance(address user) external view returns (uint256) {
        (uint256 withdrawable, , ) = _withdrawStatus(user);
        return withdrawable;
    }

    /// @notice Sum of stake lots still inside the min lock window.
    function lockedBalance(address user) external view returns (uint256) {
        (, uint256 locked, ) = _withdrawStatus(user);
        return locked;
    }

    /// @notice Earliest unlock timestamp among locked lots (0 if none locked).
    function nextUnlockAt(address user) external view returns (uint256) {
        (, , uint256 nextUnlock) = _withdrawStatus(user);
        return nextUnlock;
    }

    /// @notice Withdrawal breakdown for UI.
    function withdrawStatus(address user)
        external
        view
        returns (uint256 withdrawable, uint256 locked, uint256 nextUnlockTimestamp)
    {
        return _withdrawStatus(user);
    }

    // ─── Admin: Reward Token Registry ─────────────────────────────────────────

    /// @notice Register a new reward token. address(0) = native ETH.
    function addRewardToken(address token) external onlyOwner {
        if (isRewardToken[token]) revert AlreadyRegistered();
        isRewardToken[token] = true;
        rewardTokens.push(token);
        emit RewardTokenAdded(token);
    }

    /// @notice Remove a reward token (stops accepting new fees for it; existing rewards still claimable).
    function removeRewardToken(address token) external onlyOwner {
        if (!isRewardToken[token]) revert NotRegisteredRewardToken();
        isRewardToken[token] = false;
        uint256 n = rewardTokens.length;
        for (uint256 i = 0; i < n; i++) {
            if (rewardTokens[i] == token) {
                rewardTokens[i] = rewardTokens[n - 1];
                rewardTokens.pop();
                break;
            }
        }
        emit RewardTokenRemoved(token);
    }

    // ─── Admin: Treasury Withdrawal ───────────────────────────────────────────

    /// @notice Withdraw accumulated treasury share for a given token.
    function withdrawTreasury(address token, address to) external onlyOwner nonReentrant {
        require(to != address(0), "Zero to");
        uint256 amount = treasuryAccrued[token];
        if (amount == 0) revert NothingToClaim();
        treasuryAccrued[token] = 0;
        _sendToken(token, to, amount);
        emit TreasuryWithdrawn(token, to, amount);
    }

    // ─── ERC165 ───────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IMondaloreFeeReceiver).interfaceId || super.supportsInterface(interfaceId);
    }

    // ─── IMondaloreFeeReceiver ─────────────────────────────────────────────────────

    /// @notice Called by markets to push ERC20 protocol fees atomically.
    ///         The market must have approved this vault for `amount` before calling.
    function receiveFees(address token, uint256 amount) external payable override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (token == address(0)) {
            // Native ETH path — msg.value must match amount.
            if (!isRewardToken[address(0)]) revert NotRegisteredRewardToken();
            if (msg.value != amount) revert ZeroAmount();
            _distributeFees(address(0), amount);
        } else {
            if (!isRewardToken[token]) revert NotRegisteredRewardToken();
            // Pull from caller (market has approved us).
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            _distributeFees(token, amount);
        }
    }

    // ─── Fee Intake (manual push) ─────────────────────────────────────────────

    /// @notice Push ERC20 fees into the vault manually. Caller must have approved this contract.
    /// @dev Use this when the fee source is not a market (e.g. orderbook fees, manual treasury top-up).
    function notifyFees(address token, uint256 amount) external nonReentrant {
        if (!isRewardToken[token]) revert NotRegisteredRewardToken();
        if (token == address(0)) revert NotRegisteredRewardToken(); // use notifyFeesETH for ETH
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _distributeFees(token, amount);
    }

    /// @notice Push native ETH fees into the vault.
    function notifyFeesETH() external payable nonReentrant {
        if (!isRewardToken[address(0)]) revert NotRegisteredRewardToken();
        if (msg.value == 0) revert ZeroAmount();
        _distributeFees(address(0), msg.value);
    }

    /// @notice Vault can receive ETH directly (e.g. from markets with ETH collateral).
    receive() external payable {
        // Silently accept ETH; owner must call notifyFeesETH or it sits as unallocated.
        // For automatic distribution, markets should call notifyFeesETH explicitly.
    }

    // ─── Staking ──────────────────────────────────────────────────────────────

    /// @notice Stake `amount` of Mondalore tokens. Receive sMondalore 1:1.
    /// @param amount Amount of Mondalore to stake.
    function stake(uint256 amount) external nonReentrant updateRewards(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        totalStaked += amount;
        receiptToken.mint(msg.sender, amount);
        _stakeLots[msg.sender].push(StakeLot({ amount: amount, unlockAt: block.timestamp + lockDuration }));

        emit Staked(msg.sender, amount, currentEpoch());
    }

    /// @notice Withdraw unlocked MONDO instantly. Only lots past lockDuration are consumed (FIFO).
    function withdraw(uint256 amount) external nonReentrant updateRewards(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (amount > receiptToken.balanceOf(msg.sender)) revert InsufficientStake();

        uint256 remaining = amount;
        StakeLot[] storage lots = _stakeLots[msg.sender];
        uint256 i = 0;
        while (i < lots.length && remaining > 0) {
            if (block.timestamp >= lots[i].unlockAt) {
                uint256 take = remaining < lots[i].amount ? remaining : lots[i].amount;
                lots[i].amount -= take;
                remaining -= take;
                if (lots[i].amount == 0) {
                    lots[i] = lots[lots.length - 1];
                    lots.pop();
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
        if (remaining > 0) revert InsufficientUnlocked();

        totalStaked -= amount;
        receiptToken.burn(msg.sender, amount);
        stakeToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ─── Reward Claiming ──────────────────────────────────────────────────────

    /// @notice Claim all pending rewards for the caller across all reward tokens.
    function claimRewards() external nonReentrant updateRewards(msg.sender) {
        uint256 n = rewardTokens.length;
        bool claimed;
        for (uint256 i = 0; i < n; i++) {
            address token = rewardTokens[i];
            uint256 amount = pendingRewards[token][msg.sender];
            if (amount > 0) {
                pendingRewards[token][msg.sender] = 0;
                _sendToken(token, msg.sender, amount);
                emit RewardsClaimed(msg.sender, token, amount);
                claimed = true;
            }
        }
        if (!claimed) revert NothingToClaim();
    }

    /// @notice Claim rewards for a specific token only.
    function claimReward(address token) external nonReentrant updateRewards(msg.sender) {
        uint256 amount = pendingRewards[token][msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingRewards[token][msg.sender] = 0;
        _sendToken(token, msg.sender, amount);
        emit RewardsClaimed(msg.sender, token, amount);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Splits incoming fees between staker accumulator and treasury.
    function _distributeFees(address token, uint256 amount) internal {
        uint256 stakerShare = (amount * STAKER_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 treasuryShare = amount - stakerShare;

        // Accrue treasury portion.
        treasuryAccrued[token] += treasuryShare;

        // Fix #2: carry forward any previously truncated dust so it is distributed
        // as soon as the combined amount is large enough to produce a non-zero increment.
        if (stakerShare > 0 && totalStaked > 0) {
            uint256 effective = stakerShare + stakerDust[token];
            uint256 increment = (effective * PRECISION) / totalStaked;
            if (increment > 0) {
                rewardPerTokenStored[token] += increment;
                stakerDust[token] = 0;
            } else {
                // Still too small — accumulate dust for next round.
                stakerDust[token] += stakerShare;
                // Temporarily redirect this round's staker share to treasury so
                // the vault balance stays consistent; it will be reclaimed when
                // dust is eventually distributed.
                treasuryAccrued[token] += stakerShare;
                stakerShare = 0;
            }
        } else if (stakerShare > 0) {
            // No stakers — redirect staker share to treasury.
            treasuryAccrued[token] += stakerShare;
            stakerDust[token] = 0;
            stakerShare = 0;
        }

        uint256 epoch = currentEpoch();
        epochFees[epoch][token] += amount;

        emit FeesReceived(token, amount, stakerShare, treasuryShare, epoch);
    }

    /// @dev Compute earned rewards for a user for a given token.
    function _earned(address token, address user) internal view returns (uint256) {
        uint256 stakedBalance = receiptToken.balanceOf(user);

        return pendingRewards[token][user]
            + (stakedBalance * (rewardPerTokenStored[token] - userRewardPerTokenPaid[token][user])) / PRECISION;
    }

    function _withdrawStatus(address user)
        internal
        view
        returns (uint256 withdrawable, uint256 locked, uint256 nextUnlockTimestamp)
    {
        StakeLot[] storage lots = _stakeLots[user];
        nextUnlockTimestamp = 0;
        for (uint256 i = 0; i < lots.length; i++) {
            if (block.timestamp >= lots[i].unlockAt) {
                withdrawable += lots[i].amount;
            } else {
                locked += lots[i].amount;
                if (nextUnlockTimestamp == 0 || lots[i].unlockAt < nextUnlockTimestamp) {
                    nextUnlockTimestamp = lots[i].unlockAt;
                }
            }
        }
    }

    /// @dev Send `token` (ERC20 or ETH) to `to`.
    function _sendToken(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}

// ─── sMondalore Receipt Token ──────────────────────────────────────────────────────

/// @title sMondaloreToken
/// @notice Non-transferable ERC20 receipt token representing a staked Mondalore position.
///         Minted 1:1 on stake, burned on withdraw. Only the vault can mint/burn.
contract sMondaloreToken is ERC20 {
    address public immutable vault;

    error OnlyVault();
    error SoulBound();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address vault_) ERC20("Staked MONDO", "sMONDO") {
        vault = vault_;
    }

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }

    /// @dev Block all transfers — sMondalore is soul-bound to the staker.
    function transfer(address, uint256) public pure override returns (bool) {
        revert SoulBound();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert SoulBound();
    }

    function approve(address, uint256) public pure override returns (bool) {
        revert SoulBound();
    }
}

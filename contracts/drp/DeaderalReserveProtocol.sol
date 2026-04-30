// SPDX-License-Identifier: BUSL-1.1
//
// Business Source License 1.1
//
// Copyright (c) 2026 DEADBOX Ant Opara
//
// Use of this software is governed by the Business Source License 1.1.
// This code is provided for reference, review, and non-production use only.
//
// Commercial use, deployment, or operation of this software or any
// derivative works is prohibited without an explicit license from
// the copyright holder.
//
// This license automatically converts to the GNU General Public License v3.0
// (GPL-3.0) after a period of ten (10) years from the date of first publication.
//
// Governing law and jurisdiction: Singapore.

// Author: Ant Opara
// Email: hi@dead.box
// contact@theswitch.box

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IAFTRAggregatorV3.sol";
import "../interfaces/IUSDeAD.sol";

interface ITreasurySplitter {
    function distribute(address _token) external;
}

interface IStabilityPool {
    /**
     * @notice Absorb a liquidated vault's debt.
     *         DRP must transfer `_collAmount` of `_collToken` to SP before calling.
     * @param _collToken     Collateral token (already in SP).
     * @param _debtToOffset  USDeAD debt transferred back to DRP for burning.
     * @param _collAmount    Collateral amount transferred to SP.
     */
    function offset(
        address _collToken,
        uint256 _debtToOffset,
        uint256 _collAmount
    ) external;
    function getTotalUSDeADDeposits() external view returns (uint256);
}

/*
 * DeaderalReserveProtocol (DRP)
 *
 * CDP manager for USDeAD stablecoin backed by ETH-denominated collateral.
 */
contract DeaderalReserveProtocol is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IUSDeAD public immutable usdead;
    address public immutable VaultDistributor;
    IStabilityPool public immutable stabilityPool;

    struct InitParams {
        address weth;
        address reth;
        address wstETH;
        address wethFeed;
        address rethFeed;
        address wstETHFeed;
        address usdead;
        address treasury;
        address distro;
        address stabilityPool;
        address vaultDistributor;
        address defaultAdmin;
        address paramSetterAdmin;
    }

    address public treasury;
    address public undeadDistro;
    address public paramSetterAdmin;

    uint256 public totalVaultDebt;
    uint256 public collateralRatio;
    uint256 public unstakeDelay;
    uint256 public pendingVaultDebt;

    uint256 public LIQUIDATION_THRESHOLD = 1.15e18;

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant TIMELOCK_DELAY = 48 hours;

    enum TimelockOp {
        RenounceOwner,
        SetDistro,
        SetVaultManager,
        RenounceDivAdmin,
        BurnAmount,
        TransferOwner
    }

    struct CollateralSettings {
        bool isAllowed;
        uint256 totalDeposited;
    }
    struct PendingOp {
        address addr;
        uint256 value;
        uint256 validAt;
        bool exists;
    }
    mapping(address => CollateralSettings) public collateralConfig;
    address[] public allowedCollaterals;

    struct Vault {
        uint256 collateral;
        uint256 debt;
        uint256 pendingWithdrawalAmount;
        uint256 unlockTimestamp;
        bool hasPendingWithdrawal;
        bool isClosing;
        bool isLiquidated;
        uint256 liquidationTimestamp;
        uint256 lastCancelTimestamp;
    }

    struct UserLiquidationInfo {
        address collateralToken;
        uint256 remainingDebt;
        uint256 timestamp;
    }

    struct LiquidationRecord {
        uint256 timestamp;
        address collateralToken;
        uint256 collateralSeized;
        uint256 debtCovered;
        uint256 watchdogReward;
        address watchdogAddress;
    }

    struct LiquidationSplit {
        uint256 collForDepositors;
        uint256 benefitColl;
        uint256 treasuryColl;
        uint256 distroColl;
        uint256 watchdogColl;
    }

    struct PendingLiquidation {
        address collateralToken;
        uint256 debt;
        address liquidatedUser;
        address watchdogCaller;
        uint256 totalCollateralSeized;
    }

    LiquidationRecord[] public liquidationHistory;
    PendingLiquidation[] public pendingLiquidations;
    mapping(address => uint256) public pendingCollateralHeld;
    mapping(address => mapping(address => Vault)) public vaults;
    mapping(address => bool) public trustedManagers;
    mapping(address => mapping(address => bool)) public isVaultManager;
    mapping(TimelockOp => PendingOp) public pendingOps;
    mapping(address => mapping(address => uint256))
        public pendingLiquidationIndex;
    mapping(address => uint256) public totalPendingWithdrawals;
    mapping(address => mapping(address => bool))
        public isPendingLiquidationVault;
    mapping(address => address) public collateralFeed;

    event VaultUpdated(
        address indexed user,
        address indexed token,
        uint256 newCollateral,
        uint256 newDebt
    );
    event WithdrawalRequested(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 unlockTime
    );
    event WithdrawalClaimed(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event CollateralAdded(address indexed token);
    event ManagerAuthSet(
        address indexed user,
        address indexed manager,
        bool status
    );
    event LiquidationTriggered(
        address indexed user,
        address indexed collateralToken,
        uint256 collateralSeized,
        uint256 watchdogUSDeAD,
        uint256 debtBurned
    );
    event BatchLiquidation(uint256 attempted, uint256 successCount);
    event PendingLiquidationQueued(
        address indexed user,
        address indexed collateralToken,
        uint256 debt,
        uint256 collateralSeized
    );
    event PendingLiquidationProcessed(
        uint256 indexed pendingIndex,
        address indexed collateralToken,
        uint256 debtBurned
    );
    event WithdrawalCancelled(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event OpScheduled(
        TimelockOp indexed op,
        address addr,
        uint256 value,
        uint256 validAt
    );
    event OpApplied(TimelockOp indexed op, address addr, uint256 value);
    error DRP__TokenNotAllowed();
    error DRP__ManagerNotWhitelisted();
    error DRP__CancelCooldown(uint256 nextAllowedAt);
    error DRP__WaitDelay(uint256 unlockTime);
    error DRP__NoPendingWithdrawal();
    error DRP__HealthFactorTooLow(uint256 health);
    error DRP__HealthHealthy();
    error DRP__InsufficientBalance();
    error DRP__TimelockNotReady();
    error DRP__UnauthorizedOp();
    error DRP__NoPendingOp();
    error DRP__InvalidAddress();
    error DRP__InvalidValue();
    error DRP__LengthMissMatch();
    error DRP__NoDebt();
    error DRP__Vault_LiquidatedAlready();
    error DRP__PendingWithdrawalExists();
    error DRP__UnsafeParameterRatio();
    error DRP__StabilityPoolInsufficient(uint256 available, uint256 required);
    error DRP__SplitInvariantBroken(uint256 totalSeized, uint256 sumOfLegs);

    constructor(InitParams memory params) Ownable(params.defaultAdmin) {
        if (
            params.weth == address(0) ||
            params.reth == address(0) ||
            params.wstETH == address(0) ||
            params.wethFeed == address(0) ||
            params.rethFeed == address(0) ||
            params.wstETHFeed == address(0) ||
            params.usdead == address(0) ||
            params.treasury == address(0) ||
            params.distro == address(0) ||
            params.vaultDistributor == address(0) ||
            params.defaultAdmin == address(0) ||
            params.stabilityPool == address(0)
        ) revert DRP__InvalidAddress();

        usdead = IUSDeAD(params.usdead);
        treasury = params.treasury;
        paramSetterAdmin = params.paramSetterAdmin;
        undeadDistro = params.distro;
        VaultDistributor = params.vaultDistributor;
        stabilityPool = IStabilityPool(params.stabilityPool);

        collateralFeed[params.weth] = params.wethFeed;
        collateralFeed[params.reth] = params.rethFeed;
        collateralFeed[params.wstETH] = params.wstETHFeed;

        collateralRatio = 1.25e18;
        unstakeDelay = 1 hours;

        _allowCollateral(params.weth);
        _allowCollateral(params.reth);
        _allowCollateral(params.wstETH);
    }

    function _allowCollateral(address _token) internal {
        collateralConfig[_token].isAllowed = true;
        allowedCollaterals.push(_token);
        emit CollateralAdded(_token);
    }

    function _to18(
        address _token,
        uint256 _amount
    ) public view returns (uint256) {
        uint8 dec = IERC20Metadata(_token).decimals();
        if (dec < 18) return _amount * (10 ** (18 - dec));
        if (dec > 18) return _amount / (10 ** (dec - 18));
        return _amount;
    }

    /// @dev Reads Chainlink answer and normalizes to 18 decimals.
    function _getPrice(address _token) internal view returns (uint256) {
        address feed = collateralFeed[_token];
        if (feed == address(0)) revert DRP__TokenNotAllowed();
        (, int256 answer, , uint256 updatedAt, ) = IAFTRAggregatorV3(feed)
            .latestRoundData();
        require(answer > 0, "Invalid price");
        require(updatedAt > 0, "Stale price");
        uint256 p = uint256(answer);
        uint8 dec = IAFTRAggregatorV3(feed).decimals();
        if (dec < 18) return p * (10 ** (18 - dec));
        if (dec > 18) return p / (10 ** (dec - 18));
        return p;
    }

    modifier onlyVaultAuthority(address _vaultOwner) {
        require(
            msg.sender == _vaultOwner ||
                (trustedManagers[msg.sender] &&
                    isVaultManager[_vaultOwner][msg.sender]),
            "Not Authorized: not Owner or Manager"
        );
        _;
    }
    function _checkOpAuth(TimelockOp _op) internal view {
        if (
            _op == TimelockOp.RenounceOwner || _op == TimelockOp.TransferOwner
        ) {
            if (msg.sender != owner()) revert DRP__UnauthorizedOp();
        } else if (
            _op == TimelockOp.SetDistro ||
            _op == TimelockOp.SetVaultManager ||
            _op == TimelockOp.RenounceDivAdmin
        ) {
            if (msg.sender != paramSetterAdmin) revert DRP__UnauthorizedOp();
        } else if (_op == TimelockOp.BurnAmount) {
            if (msg.sender != VaultDistributor) revert DRP__UnauthorizedOp();
        }
    }

    function schedule(TimelockOp _op, address _addr, uint256 _value) external {
        _checkOpAuth(_op);
        if (_op == TimelockOp.SetDistro) {
            if (_addr == address(0)) revert DRP__InvalidAddress();
        } else if (_op == TimelockOp.SetVaultManager) {
            if (_addr == address(0)) revert DRP__InvalidAddress();
        } else if (_op == TimelockOp.BurnAmount) {
            if (_value == 0) revert DRP__InvalidValue();
            _addr = address(VaultDistributor);
        }

        uint256 validAt = _op == TimelockOp.SetVaultManager
            ? block.timestamp
            : block.timestamp + TIMELOCK_DELAY;
        pendingOps[_op] = PendingOp({
            addr: _addr,
            value: _value,
            validAt: validAt,
            exists: true
        });
        emit OpScheduled(_op, _addr, _value, validAt);
    }

    function executeOp(TimelockOp _op) external {
        _checkOpAuth(_op);

        PendingOp memory op = pendingOps[_op];
        if (!op.exists) revert DRP__NoPendingOp();
        if (block.timestamp < op.validAt) revert DRP__TimelockNotReady();

        delete pendingOps[_op];
        emit OpApplied(_op, op.addr, op.value);

        if (_op == TimelockOp.RenounceOwner) {
            super.renounceOwnership();
        } else if (_op == TimelockOp.TransferOwner) {
            if (op.addr == address(0)) revert DRP__InvalidAddress();
            super._transferOwnership(op.addr);
        } else if (_op == TimelockOp.SetDistro) {
            undeadDistro = op.addr;
        } else if (_op == TimelockOp.SetVaultManager) {
            trustedManagers[op.addr] = op.value == 1;
        } else if (_op == TimelockOp.RenounceDivAdmin) {
            paramSetterAdmin = address(0);
        } else if (_op == TimelockOp.BurnAmount) {
            usdead.burnFrom(op.addr, op.value);
        }
    }

    function transferOwnership(
        address /* newOwner */
    ) public view override onlyOwner {
        revert("Use schedule(TransferOwner, newOwner, 0) and executeOp");
    }
    function renounceOwnership() public view override onlyOwner {
        revert("Use executeOp(RenounceOwner) after scheduling");
    }

    function approveManager(address _manager, bool _active) external {
        if (_manager == address(0)) revert DRP__InvalidAddress();
        if (_active && !trustedManagers[_manager])
            revert DRP__ManagerNotWhitelisted();
        isVaultManager[msg.sender][_manager] = _active;
        emit ManagerAuthSet(msg.sender, _manager, _active);
    }

    function depositAndMint(
        address _token,
        uint256 _colAmount,
        uint256 _mintAmount,
        address _user
    ) external nonReentrant onlyVaultAuthority(_user) {
        Vault storage v = vaults[_user][_token];

        if (v.isLiquidated) {
            if (
                v.collateral == 0 &&
                v.debt == 0 &&
                v.pendingWithdrawalAmount == 0 &&
                !isPendingLiquidationVault[_user][_token]
            ) {
                v.isLiquidated = false;
                v.liquidationTimestamp = 0;
                v.isClosing = false;
                v.unlockTimestamp = 0;
            } else {
                revert DRP__Vault_LiquidatedAlready();
            }
        }
        if (!collateralConfig[_token].isAllowed) revert DRP__TokenNotAllowed();

        if (_colAmount > 0) {
            uint256 balBefore = IERC20(_token).balanceOf(address(this));
            IERC20(_token).safeTransferFrom(_user, address(this), _colAmount);
            uint256 actualReceived = IERC20(_token).balanceOf(address(this)) -
                balBefore;
            vaults[_user][_token].collateral += actualReceived;
            collateralConfig[_token].totalDeposited += actualReceived;
        }

        if (_mintAmount > 0) {
            vaults[_user][_token].debt += _mintAmount;
            totalVaultDebt += _mintAmount;
            usdead.mint(_user, _mintAmount);
            _revertIfHealthFactorIsBroken(_user, _token);
        }

        emit VaultUpdated(
            _user,
            _token,
            vaults[_user][_token].collateral,
            vaults[_user][_token].debt
        );
    }

    function requestWithdrawal(
        address _token,
        uint256 _amount
    ) external nonReentrant {
        if (_amount == 0) revert DRP__InvalidValue();
        Vault storage v = vaults[msg.sender][_token];
        if (v.collateral < _amount) revert DRP__InsufficientBalance();
        if (v.hasPendingWithdrawal) revert DRP__PendingWithdrawalExists();
        if (vaults[msg.sender][_token].isClosing)
            revert("Cannot request during closing");
        if (v.isLiquidated) revert DRP__Vault_LiquidatedAlready();
        if (block.timestamp < v.lastCancelTimestamp + 1 hours)
            revert DRP__CancelCooldown(v.lastCancelTimestamp + 1 hours);

        v.collateral -= _amount;
        if (v.debt > 0) _revertIfHealthFactorIsBroken(msg.sender, _token);
        v.pendingWithdrawalAmount += _amount;
        v.hasPendingWithdrawal = true;
        totalPendingWithdrawals[_token] += _amount;
        v.unlockTimestamp = block.timestamp + unstakeDelay;

        emit WithdrawalRequested(
            msg.sender,
            _token,
            _amount,
            v.unlockTimestamp
        );
    }

    function cancelWithdrawal(address _token) external nonReentrant {
        Vault storage v = vaults[msg.sender][_token];

        if (v.pendingWithdrawalAmount == 0) revert DRP__NoPendingWithdrawal();
        if (v.isLiquidated) revert DRP__Vault_LiquidatedAlready();
        if (v.isClosing) revert("Cannot cancel during vault close");

        uint256 amount = v.pendingWithdrawalAmount;
        v.pendingWithdrawalAmount = 0;
        v.hasPendingWithdrawal = false;
        totalPendingWithdrawals[_token] -= amount;
        v.collateral += amount;
        v.unlockTimestamp = 0;
        v.lastCancelTimestamp = block.timestamp;
        emit WithdrawalCancelled(msg.sender, _token, amount);
    }

    function claimWithdrawal(address _token) external nonReentrant {
        Vault storage v = vaults[msg.sender][_token];
        if (block.timestamp < v.unlockTimestamp)
            revert DRP__WaitDelay(v.unlockTimestamp);
        if (v.pendingWithdrawalAmount == 0) revert DRP__NoPendingWithdrawal();
        if (v.isLiquidated) revert DRP__Vault_LiquidatedAlready();
        uint256 amount = v.pendingWithdrawalAmount;
        v.pendingWithdrawalAmount = 0;
        v.hasPendingWithdrawal = false;

        if (v.debt > 0) {
            uint256 health = _calculateHealthFactor(msg.sender, _token);
            if (health < collateralRatio)
                revert DRP__HealthFactorTooLow(health);
        }
        totalPendingWithdrawals[_token] -= amount;
        collateralConfig[_token].totalDeposited -= amount;
        v.isClosing = false;

        IERC20(_token).safeTransfer(msg.sender, amount);
        emit WithdrawalClaimed(msg.sender, _token, amount);
    }

    function closeVault(
        address _user,
        address _collateralToken
    ) external nonReentrant onlyVaultAuthority(_user) {
        Vault storage v = vaults[_user][_collateralToken];
        if (v.isLiquidated) revert DRP__Vault_LiquidatedAlready();

        uint256 debt = v.debt;
        uint256 collateral = v.collateral;
        require(debt > 0 || collateral > 0, "Vault empty");

        if (debt > 0) {
            uint256 fee = (debt * 100) / BPS_DENOMINATOR;
            uint256 total = debt + fee;
            IERC20(address(usdead)).safeTransferFrom(_user, address(this), total);
            usdead.burnFrom(address(this), debt);

            if (fee > 0) {
                uint256 distroPart = fee / 2;
                uint256 treasuryPart = fee - distroPart;
                IERC20(address(usdead)).safeTransfer(undeadDistro, distroPart);
                IERC20(address(usdead)).safeTransfer(treasury, treasuryPart);
                ITreasurySplitter(treasury).distribute(address(usdead));
            }

            totalVaultDebt -= debt;
            v.debt = 0;
        }

        if (collateral > 0) {
            v.collateral = 0;
            v.pendingWithdrawalAmount += collateral;
            v.hasPendingWithdrawal = true;
            totalPendingWithdrawals[_collateralToken] += collateral;
            v.unlockTimestamp = block.timestamp + unstakeDelay;
            v.isClosing = true;
        }

        emit VaultUpdated(_user, _collateralToken, 0, 0);
    }

    function repayDebt(
        address _user,
        address _token,
        uint256 _amountDebtToBurn
    ) external nonReentrant onlyVaultAuthority(_user) {
        Vault storage v = vaults[_user][_token];
        if (v.isLiquidated) revert DRP__Vault_LiquidatedAlready();
        if (v.debt == 0) revert DRP__NoDebt();

        uint256 burnAmount = _amountDebtToBurn > v.debt
            ? v.debt
            : _amountDebtToBurn;
        uint256 fee = (burnAmount * 100) / BPS_DENOMINATOR;
        IERC20(address(usdead)).safeTransferFrom(_user, address(this), burnAmount + fee);
        usdead.burnFrom(address(this), burnAmount);

        v.debt -= burnAmount;
        totalVaultDebt -= burnAmount;

        if (fee > 0) {
            uint256 distroPart = fee / 2;
            uint256 treasuryPart = fee - distroPart;
            IERC20(address(usdead)).safeTransfer(undeadDistro, distroPart);
            IERC20(address(usdead)).safeTransfer(treasury, treasuryPart);
            ITreasurySplitter(treasury).distribute(address(usdead));
        }

        emit VaultUpdated(_user, _token, v.collateral, v.debt);
    }

    function liquidate(address _user, address _token) public nonReentrant {
        uint256 price = _getPrice(_token);
        if (
            _calculateHealthFactorWithPrice(_user, _token, price) >=
            LIQUIDATION_THRESHOLD
        ) revert DRP__HealthHealthy();

        Vault storage v = vaults[_user][_token];
        if (v.isLiquidated || (v.collateral == 0 && v.debt == 0))
            revert DRP__Vault_LiquidatedAlready();

        uint256 totalCollateralSeized = v.collateral +
            v.pendingWithdrawalAmount;
        uint256 debt = v.debt;
        LiquidationSplit memory split = _getLiquidationSplit(
            _token,
            totalCollateralSeized,
            debt,
            price
        );
        _revertIfSplitNotConserved(totalCollateralSeized, split);
        uint256 pendingWithdrawalCached = v.pendingWithdrawalAmount;

        if (stabilityPool.getTotalUSDeADDeposits() >= debt) {
            _executeImmediateLiquidation(_token, debt, split, msg.sender);
            _finalizeLiquidation(
                v,
                _token,
                totalCollateralSeized,
                pendingWithdrawalCached,
                debt,
                split.watchdogColl,
                msg.sender
            );
            emit LiquidationTriggered(
                _user,
                _token,
                totalCollateralSeized,
                split.watchdogColl,
                debt
            );
        } else {
            _enqueuePendingLiquidation(
                _user,
                _token,
                v,
                totalCollateralSeized,
                pendingWithdrawalCached,
                debt
            );
        }
    }

    function _revertIfSplitNotConserved(
        uint256 _totalSeized,
        LiquidationSplit memory _s
    ) internal pure {
        uint256 sum = _s.collForDepositors +
            _s.benefitColl +
            _s.treasuryColl +
            _s.distroColl +
            _s.watchdogColl;
        uint256 diff = sum > _totalSeized
            ? sum - _totalSeized
            : _totalSeized - sum;
        if (diff > 1) revert DRP__SplitInvariantBroken(_totalSeized, sum);
    }

    function _enqueuePendingLiquidation(
        address _user,
        address _token,
        Vault storage v,
        uint256 totalCollateralSeized,
        uint256 pendingWithdrawalAmt,
        uint256 debt
    ) internal {
        _finalizeLiquidation(
            v,
            _token,
            totalCollateralSeized,
            pendingWithdrawalAmt,
            debt,
            0,
            address(0)
        );
        pendingVaultDebt += debt;
        pendingCollateralHeld[_token] += totalCollateralSeized;
        isPendingLiquidationVault[_user][_token] = true;
        pendingLiquidationIndex[_token][_user] = pendingLiquidations.length;
        pendingLiquidations.push(
            PendingLiquidation({
                collateralToken: _token,
                debt: debt,
                liquidatedUser: _user,
                watchdogCaller: msg.sender,
                totalCollateralSeized: totalCollateralSeized
            })
        );
        emit PendingLiquidationQueued(
            _user,
            _token,
            debt,
            totalCollateralSeized
        );
    }

    function _getLiquidationSplit(
        address _token,
        uint256 _totalCollateral,
        uint256 _debt,
        uint256 _priceUsd
    ) internal view returns (LiquidationSplit memory) {
        (
            uint256 collForDepositors,
            uint256 benefitColl,
            uint256 treasuryColl,
            uint256 distroColl,
            uint256 watchdogColl
        ) = _calculateLiquidationSplit(
                _token,
                _totalCollateral,
                _debt,
                _priceUsd
            );
        return
            LiquidationSplit({
                collForDepositors: collForDepositors,
                benefitColl: benefitColl,
                treasuryColl: treasuryColl,
                distroColl: distroColl,
                watchdogColl: watchdogColl
            });
    }

    function _executeImmediateLiquidation(
        address _token,
        uint256 debt,
        LiquidationSplit memory split,
        address watchdogCaller
    ) internal {
        IERC20(_token).safeTransfer(
            address(stabilityPool),
            split.collForDepositors
        );
        stabilityPool.offset(_token, debt, split.collForDepositors);
        usdead.burnFrom(address(this), debt);
        if (split.benefitColl > 0)
            IERC20(_token).safeTransfer(VaultDistributor, split.benefitColl);
        if (split.treasuryColl > 0) {
            IERC20(_token).safeTransfer(treasury, split.treasuryColl);
            ITreasurySplitter(treasury).distribute(_token);
        }
        if (split.distroColl > 0)
            IERC20(_token).safeTransfer(undeadDistro, split.distroColl);
        if (split.watchdogColl > 0)
            IERC20(_token).safeTransfer(watchdogCaller, split.watchdogColl);
    }

    function _finalizeLiquidation(
        Vault storage v,
        address _token,
        uint256 totalCollateralSeized,
        uint256 pendingWithdrawalAmount,
        uint256 debt,
        uint256 watchdogReward,
        address watchdogAddress
    ) internal {
        collateralConfig[_token].totalDeposited -= totalCollateralSeized;
        totalPendingWithdrawals[_token] -= pendingWithdrawalAmount;
        v.collateral = 0;
        v.pendingWithdrawalAmount = 0;
        v.hasPendingWithdrawal = false;
        v.isLiquidated = true;
        v.liquidationTimestamp = block.timestamp;
        totalVaultDebt = totalVaultDebt > debt ? totalVaultDebt - debt : 0;
        v.debt = 0;

        liquidationHistory.push(
            LiquidationRecord({
                timestamp: block.timestamp,
                collateralToken: _token,
                collateralSeized: totalCollateralSeized,
                debtCovered: debt,
                watchdogReward: watchdogReward,
                watchdogAddress: watchdogAddress
            })
        );
    }

    function _calculateLiquidationSplit(
        address _token,
        uint256 _totalCollateral,
        uint256 _debt,
        uint256 _priceUsd
    )
        internal
        view
        returns (
            uint256 collForDepositors,
            uint256 benefitColl,
            uint256 treasuryColl,
            uint256 distroColl,
            uint256 watchdogColl
        )
    {
        uint256 col18 = _to18(_token, _totalCollateral);
        uint256 collateralUSD = (col18 * _priceUsd) / 1e18;

        if (collateralUSD >= _debt) {
            uint256 debtInCol18 = (_debt * 1e18 + _priceUsd - 1) / _priceUsd;
            uint256 debtInCollateral = _from18(_token, debtInCol18);
            if (debtInCollateral > _totalCollateral)
                debtInCollateral = _totalCollateral;

            uint256 surplus = _totalCollateral - debtInCollateral;
            uint256 depositorExtra = surplus / 2;
            uint256 feePot = surplus - depositorExtra;

            collForDepositors = debtInCollateral + depositorExtra;

            benefitColl = (feePot * 25) / 50;
            treasuryColl = (feePot * 12) / 50;
            distroColl = (feePot * 12) / 50;
            watchdogColl = feePot - benefitColl - treasuryColl - distroColl;
        } else {
            watchdogColl = (_totalCollateral * 10) / BPS_DENOMINATOR;
            collForDepositors = _totalCollateral - watchdogColl;
        }
    }

    function _from18(
        address _token,
        uint256 _amount18
    ) internal view returns (uint256) {
        uint8 dec = IERC20Metadata(_token).decimals();
        if (dec < 18) return _amount18 / (10 ** (18 - dec));
        if (dec > 18) return _amount18 * (10 ** (dec - 18));
        return _amount18;
    }

    function processPendingLiquidations(
        uint256 _maxIterations
    ) external nonReentrant returns (uint256 processedCount) {
        uint256 i = 0;
        while (i < _maxIterations && pendingLiquidations.length > 0) {
            uint256 targetIdx = pendingLiquidations.length - 1;
            uint256 tailDebt = pendingLiquidations[targetIdx].debt;

            if (stabilityPool.getTotalUSDeADDeposits() >= tailDebt) {
                _processOnePendingLiquidation(
                    targetIdx,
                    pendingLiquidations[targetIdx]
                );
                _removePendingAt(targetIdx);
                processedCount++;
            } else {
                break;
            }

            i++;
        }
    }

    function processSpecificPending(uint256 _index) external nonReentrant {
        require(_index < pendingLiquidations.length, "Invalid index");
        PendingLiquidation storage p = pendingLiquidations[_index];

        uint256 spBalance = stabilityPool.getTotalUSDeADDeposits();
        if (spBalance < p.debt)
            revert DRP__StabilityPoolInsufficient(spBalance, p.debt);

        _processOnePendingLiquidation(_index, p);
        _removePendingAt(_index);
    }

    function _removePendingAt(uint256 index) internal {
        uint256 last = pendingLiquidations.length - 1;
        if (index != last) {
            PendingLiquidation storage swappedItem = pendingLiquidations[last];
            pendingLiquidationIndex[swappedItem.collateralToken][
                swappedItem.liquidatedUser
            ] = index + 1;
            pendingLiquidations[index] = swappedItem;
        }
        PendingLiquidation storage removedItem = pendingLiquidations[last];
        delete pendingLiquidationIndex[removedItem.collateralToken][
            removedItem.liquidatedUser
        ];
        pendingLiquidations.pop();
    }

    function _processOnePendingLiquidation(
        uint256 _index,
        PendingLiquidation storage p
    ) internal {
        uint256 debt = p.debt;
        address token = p.collateralToken;
        uint256 totalCollateral = p.totalCollateralSeized;
        uint256 freshPrice = _getPrice(token);
        LiquidationSplit memory split = _getLiquidationSplit(
            token,
            totalCollateral,
            debt,
            freshPrice
        );
        _revertIfSplitNotConserved(totalCollateral, split);

        IERC20(token).safeTransfer(
            address(stabilityPool),
            split.collForDepositors
        );
        stabilityPool.offset(token, debt, split.collForDepositors);
        usdead.burnFrom(address(this), debt);
        pendingVaultDebt -= debt;
        if (split.benefitColl > 0)
            IERC20(token).safeTransfer(VaultDistributor, split.benefitColl);
        if (split.treasuryColl > 0) {
            IERC20(token).safeTransfer(treasury, split.treasuryColl);
            ITreasurySplitter(treasury).distribute(token);
        }
        if (split.distroColl > 0)
            IERC20(token).safeTransfer(undeadDistro, split.distroColl);

        if (split.watchdogColl > 0) {
            uint256 executorReward = split.watchdogColl / 2;
            uint256 queuerReward = split.watchdogColl - executorReward;
            if (executorReward > 0)
                IERC20(token).safeTransfer(msg.sender, executorReward);
            if (queuerReward > 0 && p.watchdogCaller != address(0))
                IERC20(token).safeTransfer(p.watchdogCaller, queuerReward);
        }

        pendingCollateralHeld[token] -= totalCollateral;
        isPendingLiquidationVault[p.liquidatedUser][token] = false;
        emit PendingLiquidationProcessed(_index, token, debt);
    }

    function batchLiquidate(
        address[] calldata _users,
        address[] calldata _tokens
    ) external {
        if (_users.length != _tokens.length) revert DRP__LengthMissMatch();
        uint256 successCount = 0;
        for (uint256 i = 0; i < _users.length; i++) {
            Vault storage v = vaults[_users[i]][_tokens[i]];
            if (v.isLiquidated || (v.collateral == 0 && v.debt == 0)) continue;
            uint256 health = _calculateHealthFactor(_users[i], _tokens[i]);
            if (health >= LIQUIDATION_THRESHOLD) continue;
            liquidate(_users[i], _tokens[i]);
            successCount++;
        }
        emit BatchLiquidation(_users.length, successCount);
    }

    function _revertIfHealthFactorIsBroken(
        address _user,
        address _token
    ) internal view {
        uint256 hf = _calculateHealthFactor(_user, _token);
        if (hf < collateralRatio) revert DRP__HealthFactorTooLow(hf);
    }

    function _calculateHealthFactor(
        address _user,
        address _token
    ) public view returns (uint256) {
        return
            _calculateHealthFactorWithPrice(
                _user,
                _token,
                _getPrice(_token)
            );
    }

    function _calculateHealthFactorWithPrice(
        address _user,
        address _token,
        uint256 _priceUsd
    ) internal view returns (uint256) {
        Vault memory v = vaults[_user][_token];
        if (v.debt == 0) return type(uint256).max;

        uint256 totCol = v.collateral + v.pendingWithdrawalAmount;
        uint256 col18 = _to18(_token, totCol);
        uint256 colVal = (col18 * _priceUsd) / 1e18;
        return (colVal * 1e18) / v.debt;
    }

    function getSystemCollateralRatio() public view returns (uint256) {
        uint256 totalDebt = totalVaultDebt + pendingVaultDebt;
        if (totalDebt == 0) return type(uint256).max;

        uint256 totalCollateralValueUsd = 0;
        for (uint256 i = 0; i < allowedCollaterals.length; i++) {
            address token = allowedCollaterals[i];
            uint256 amount = collateralConfig[token].totalDeposited;
            uint256 price = _getPrice(token);
            uint256 amount18 = _to18(token, amount);
            totalCollateralValueUsd += (amount18 * price) / 1e18;
        }
        return (totalCollateralValueUsd * 1e18) / totalDebt;
    }

    function getTotalCollateral(
        address _token
    ) external view returns (uint256) {
        return collateralConfig[_token].totalDeposited;
    }

    function getRecentLiquidations()
        external
        view
        returns (LiquidationRecord[] memory)
    {
        uint256 len = liquidationHistory.length;
        uint256 size = len < 5 ? len : 5;
        LiquidationRecord[] memory recent = new LiquidationRecord[](size);
        for (uint256 i = 0; i < size; i++) {
            recent[i] = liquidationHistory[len - 1 - i];
        }
        return recent;
    }

    function getUserLiquidatedPositions(
        address _user
    ) external view returns (UserLiquidationInfo[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allowedCollaterals.length; i++) {
            if (vaults[_user][allowedCollaterals[i]].isLiquidated) count++;
        }
        UserLiquidationInfo[] memory result = new UserLiquidationInfo[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < allowedCollaterals.length; i++) {
            address token = allowedCollaterals[i];
            Vault storage v = vaults[_user][token];
            if (v.isLiquidated) {
                result[index] = UserLiquidationInfo({
                    collateralToken: token,
                    remainingDebt: v.debt,
                    timestamp: v.liquidationTimestamp
                });
                index++;
            }
        }
        return result;
    }

    function getProtocolHealthPercent()
        external
        view
        returns (uint256 ltvPercent)
    {
        uint256 totalDebt = totalVaultDebt + pendingVaultDebt;
        uint256 totalCollateralValue = 0;

        for (uint256 i = 0; i < allowedCollaterals.length; i++) {
            address token = allowedCollaterals[i];
            uint256 amount = collateralConfig[token].totalDeposited;
            if (amount > 0) {
                uint256 price = _getPrice(token);
                uint256 col18 = _to18(token, amount);
                totalCollateralValue += (col18 * price) / 1e18;
            }
        }
        if (totalCollateralValue == 0) return 0;
        return (totalDebt * 100) / totalCollateralValue;
    }

    function getUserVaultDetails(
        address _user,
        address _token
    )
        public
        view
        returns (
            uint256 collateral,
            uint256 debt,
            uint256 pendingWithdrawalAmount,
            uint256 unlockTimestamp,
            bool isClosing,
            bool isLiquidated
        )
    {
        Vault memory v = vaults[_user][_token];
        return (
            v.collateral,
            v.debt,
            v.pendingWithdrawalAmount,
            v.unlockTimestamp,
            v.isClosing,
            v.isLiquidated
        );
    }
}

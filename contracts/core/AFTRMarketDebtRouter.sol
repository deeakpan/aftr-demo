// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAFTRFactoryLike {
    function isMarket(address market) external view returns (bool);
}

interface IAFTRMarketLike {
    function collateralAddress() external view returns (address);
    function deposit(uint8 outcomeIndex, uint256 amount, address recipient, uint256 minSharesOut) external payable;
    function redeem(uint8 outcomeIndex, uint256 shareAmount) external;
    function outcomeToken(uint256 index) external view returns (address);
}

interface IDRPLike {
    function usdead() external view returns (address);
    function repayDebt(address user, address token, uint256 amountDebtToBurn) external;
}

/// @notice Routes market interactions and DRP repayment with a single DRP manager identity.
contract AFTRMarketDebtRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAFTRFactoryLike public immutable factory;
    IDRPLike public immutable drp;
    address public immutable usdead;

    error InvalidMarket();
    error InvalidCollateral();
    error InvalidAmount();
    error NativeUnsupported();

    event RouterDeposited(
        address indexed user,
        address indexed market,
        address indexed collateralToken,
        uint8 outcomeIndex,
        uint256 amount,
        uint256 minSharesOut
    );
    event RouterRedeemed(
        address indexed user,
        address indexed market,
        address indexed collateralToken,
        uint8 outcomeIndex,
        uint256 shareAmount,
        uint256 payoutAmount
    );
    event RouterRedeemedAndRepaid(
        address indexed user,
        address indexed market,
        address indexed drp,
        uint8 outcomeIndex,
        uint256 shareAmount,
        uint256 payoutAmount,
        address vaultCollateralToken,
        uint256 debtToBurn
    );

    constructor(address factory_, address drp_) {
        require(factory_ != address(0) && drp_ != address(0), "Zero address");
        factory = IAFTRFactoryLike(factory_);
        drp = IDRPLike(drp_);
        usdead = IDRPLike(drp_).usdead();
    }

    /// @notice Deposit collateral into a market on behalf of caller (recipient = caller).
    function depositForSelf(
        address market,
        uint8 outcomeIndex,
        uint256 amount,
        uint256 minSharesOut
    ) external nonReentrant {
        if (!factory.isMarket(market)) revert InvalidMarket();
        if (amount == 0) revert InvalidAmount();

        address collateral = IAFTRMarketLike(market).collateralAddress();
        if (collateral == address(0)) revert NativeUnsupported();

        IERC20(collateral).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(collateral).forceApprove(market, amount);
        IAFTRMarketLike(market).deposit(outcomeIndex, amount, msg.sender, minSharesOut);

        emit RouterDeposited(
            msg.sender,
            market,
            collateral,
            outcomeIndex,
            amount,
            minSharesOut
        );
    }

    /// @notice Deposit native ETH into an ETH-collateral market on behalf of caller.
    function depositForSelfNative(
        address market,
        uint8 outcomeIndex,
        uint256 minSharesOut
    ) external payable nonReentrant {
        if (!factory.isMarket(market)) revert InvalidMarket();
        if (msg.value == 0) revert InvalidAmount();

        address collateral = IAFTRMarketLike(market).collateralAddress();
        if (collateral != address(0)) revert InvalidCollateral();

        IAFTRMarketLike(market).deposit{ value: msg.value }(
            outcomeIndex,
            msg.value,
            msg.sender,
            minSharesOut
        );

        emit RouterDeposited(
            msg.sender,
            market,
            address(0),
            outcomeIndex,
            msg.value,
            minSharesOut
        );
    }

    /// @notice Redeem winning shares through router and forward payout to caller (any collateral type).
    function redeemForSelf(
        address market,
        uint8 outcomeIndex,
        uint256 shareAmount
    ) external nonReentrant {
        if (!factory.isMarket(market)) revert InvalidMarket();
        if (shareAmount == 0) revert InvalidAmount();

        address outToken = IAFTRMarketLike(market).outcomeToken(uint256(outcomeIndex));
        IERC20(outToken).safeTransferFrom(msg.sender, address(this), shareAmount);

        address collateral = IAFTRMarketLike(market).collateralAddress();
        uint256 payout;
        if (collateral == address(0)) {
            uint256 balBefore = address(this).balance;
            IAFTRMarketLike(market).redeem(outcomeIndex, shareAmount);
            payout = address(this).balance - balBefore;
            if (payout > 0) {
                (bool ok, ) = payable(msg.sender).call{ value: payout }("");
                require(ok, "ETH transfer");
            }
        } else {
            uint256 balBefore = IERC20(collateral).balanceOf(address(this));
            IAFTRMarketLike(market).redeem(outcomeIndex, shareAmount);
            payout = IERC20(collateral).balanceOf(address(this)) - balBefore;
            if (payout > 0) IERC20(collateral).safeTransfer(msg.sender, payout);
        }

        emit RouterRedeemed(
            msg.sender,
            market,
            collateral,
            outcomeIndex,
            shareAmount,
            payout
        );
    }

    /// @notice Redeem winning shares through router, then call DRP repayDebt for caller.
    /// @dev Caller must approve router for the winning outcome token.
    function redeemAndRepayForSelf(
        address market,
        uint8 outcomeIndex,
        uint256 shareAmount,
        address vaultCollateralToken,
        uint256 debtToBurn
    ) external nonReentrant {
        if (!factory.isMarket(market)) revert InvalidMarket();
        if (shareAmount == 0) revert InvalidAmount();

        address collateral = IAFTRMarketLike(market).collateralAddress();
        if (collateral == address(0) || collateral != usdead) revert InvalidCollateral();

        address outToken = IAFTRMarketLike(market).outcomeToken(uint256(outcomeIndex));
        IERC20(outToken).safeTransferFrom(msg.sender, address(this), shareAmount);

        uint256 balBefore = IERC20(usdead).balanceOf(address(this));
        IAFTRMarketLike(market).redeem(outcomeIndex, shareAmount);

        uint256 payout = IERC20(usdead).balanceOf(address(this)) - balBefore;
        if (payout > 0) IERC20(usdead).safeTransfer(msg.sender, payout);

        // DRP pulls (debt + fee) from caller wallet. Caller should pre-approve DRP for USDeAD.
        drp.repayDebt(msg.sender, vaultCollateralToken, debtToBurn);

        emit RouterRedeemedAndRepaid(
            msg.sender,
            market,
            address(drp),
            outcomeIndex,
            shareAmount,
            payout,
            vaultCollateralToken,
            debtToBurn
        );
    }

    receive() external payable {}
}

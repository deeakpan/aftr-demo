// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ZedkrTradeFees
/// @notice 1.0% trade fee split equally: creator / platform dev / distribution / treasury.
///         Any recipient left as address(0) is paid to the market creator instead.
library ZedkrTradeFees {
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant TRADE_FEE_TOTAL_BPS = 100;
    uint256 internal constant FEE_SHARE_BPS = 25;

    struct Split {
        uint256 creatorAmt;
        uint256 platformDevAmt;
        uint256 distributionAmt;
        uint256 treasuryAmt;
        uint256 netAmount;
    }

    function quote(
        uint256 amount,
        address platformDev,
        address distribution,
        address treasury
    ) internal pure returns (Split memory s) {
        uint256 totalFee = (amount * TRADE_FEE_TOTAL_BPS) / BPS_DENOMINATOR;
        uint256 share = totalFee / 4;
        s.platformDevAmt = share;
        s.distributionAmt = share;
        s.treasuryAmt = share;
        s.creatorAmt = totalFee - share * 3;
        s.netAmount = amount - totalFee;

        if (platformDev == address(0)) {
            s.creatorAmt += s.platformDevAmt;
            s.platformDevAmt = 0;
        }
        if (distribution == address(0)) {
            s.creatorAmt += s.distributionAmt;
            s.distributionAmt = 0;
        }
        if (treasury == address(0)) {
            s.creatorAmt += s.treasuryAmt;
            s.treasuryAmt = 0;
        }
    }
}

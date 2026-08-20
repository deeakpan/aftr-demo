// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ZedkrFpmmMath
/// @notice Constant-product market maker math (Gnosis FPMM), adapted for Zedkr markets.
library ZedkrFpmmMath {
    uint256 internal constant ONE = 1e18;

    function ceildiv(uint256 x, uint256 y) internal pure returns (uint256) {
        if (x > 0) return ((x - 1) / y) + 1;
        return x / y;
    }

    /// @dev Outcome tokens received when spending `investmentAmount` on `outcomeIndex`.
    function calcBuyAmount(
        uint256 investmentAmount,
        uint256 outcomeIndex,
        uint256[] memory poolBalances,
        uint256 feeBps
    ) internal pure returns (uint256) {
        require(outcomeIndex < poolBalances.length, "Invalid outcome");
        require(poolBalances.length > 1, "Pool size");

        uint256 investmentAmountMinusFees = investmentAmount - ((investmentAmount * feeBps) / 10_000);
        uint256 buyTokenPoolBalance = poolBalances[outcomeIndex];
        uint256 endingOutcomeBalance = buyTokenPoolBalance * ONE;

        for (uint256 i = 0; i < poolBalances.length; i++) {
            if (i != outcomeIndex) {
                uint256 poolBalance = poolBalances[i];
                endingOutcomeBalance =
                    (endingOutcomeBalance * poolBalance) /
                    ceildiv(poolBalance + investmentAmountMinusFees, 1);
            }
        }

        require(endingOutcomeBalance > 0, "Zero ending balance");
        return buyTokenPoolBalance + investmentAmountMinusFees - ceildiv(endingOutcomeBalance, ONE);
    }

    /// @dev Outcome tokens required to receive `returnAmount` collateral (before fee gross-up).
    function calcSellAmount(
        uint256 returnAmount,
        uint256 outcomeIndex,
        uint256[] memory poolBalances,
        uint256 feeBps
    ) internal pure returns (uint256) {
        require(outcomeIndex < poolBalances.length, "Invalid outcome");
        require(poolBalances.length > 1, "Pool size");
        require(feeBps < 10_000, "Fee range");

        uint256 returnAmountPlusFees = (returnAmount * 10_000) / (10_000 - feeBps);
        uint256 sellTokenPoolBalance = poolBalances[outcomeIndex];
        uint256 endingOutcomeBalance = sellTokenPoolBalance * ONE;

        for (uint256 i = 0; i < poolBalances.length; i++) {
            if (i != outcomeIndex) {
                uint256 poolBalance = poolBalances[i];
                endingOutcomeBalance =
                    (endingOutcomeBalance * poolBalance) /
                    ceildiv(poolBalance - returnAmountPlusFees, 1);
            }
        }

        require(endingOutcomeBalance > 0, "Zero ending balance");
        return returnAmountPlusFees + ceildiv(endingOutcomeBalance, ONE) - sellTokenPoolBalance;
    }

    /// @dev Implied probability for display (binary-friendly; general n-outcome approximation).
    function marginalPrice(uint256[] memory poolBalances, uint256 outcomeIndex) internal pure returns (uint256) {
        require(outcomeIndex < poolBalances.length, "Invalid outcome");
        if (poolBalances.length == 2) {
            uint256 other = outcomeIndex == 0 ? 1 : 0;
            uint256 sum = poolBalances[0] + poolBalances[1];
            if (sum == 0) return 0;
            return (poolBalances[other] * ONE) / sum;
        }

        uint256 invSum;
        uint256[] memory inv = new uint256[](poolBalances.length);
        for (uint256 i = 0; i < poolBalances.length; i++) {
            require(poolBalances[i] > 0, "Empty pool");
            inv[i] = ONE * ONE / poolBalances[i];
            invSum += inv[i];
        }
        return (inv[outcomeIndex] * ONE) / invSum;
    }
}

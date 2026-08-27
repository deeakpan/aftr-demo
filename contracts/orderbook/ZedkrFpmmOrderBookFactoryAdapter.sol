// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IZedkrFpmmMarketFactoryView {
    function isMarket(address market) external view returns (bool);
    function getMarketOutcomeTokens(address market) external view returns (address[] memory);
}

/// @title ZedkrFpmmOrderBookFactoryAdapter
/// @notice Exposes MondaloreOrderBook's factory interface against an already-deployed
///         ZedkrFpmmMarketFactory that may lack `isOutcomeTokenForMarket` on-chain.
contract ZedkrFpmmOrderBookFactoryAdapter {
    IZedkrFpmmMarketFactoryView public immutable fpmmFactory;

    error ZeroAddress();

    constructor(address fpmmFactory_) {
        if (fpmmFactory_ == address(0)) revert ZeroAddress();
        fpmmFactory = IZedkrFpmmMarketFactoryView(fpmmFactory_);
    }

    function isMarket(address market) external view returns (bool) {
        return fpmmFactory.isMarket(market);
    }

    function isOutcomeTokenForMarket(address market, address token) external view returns (bool) {
        address[] memory tokens = fpmmFactory.getMarketOutcomeTokens(market);
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) return true;
        }
        return false;
    }
}

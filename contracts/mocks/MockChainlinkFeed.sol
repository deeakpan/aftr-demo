// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal mock Chainlink AggregatorV3 for testing.
contract MockChainlinkFeed {
    int256 private _answer;
    uint8 private _decimals;
    uint80 private _roundId;

    constructor(int256 answer_, uint8 decimals_) {
        _answer = answer_;
        _decimals = decimals_;
        _roundId = 1;
    }

    function setAnswer(int256 answer_) external {
        _roundId++;
        _answer = answer_;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, _answer, block.timestamp, block.timestamp, _roundId);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Ownable mock Chainlink AggregatorV3 for testnets without live feeds.
contract MockChainlinkFeed is Ownable {
    int256 private _answer;
    uint8 private immutable _decimals;
    uint80 private _roundId;

    constructor(int256 answer_, uint8 decimals_, address owner_) Ownable(owner_) {
        _answer = answer_;
        _decimals = decimals_;
        _roundId = 1;
    }

    /// @notice Owner updates the reported price (e.g. BTC/USD with 8 decimals).
    function setAnswer(int256 answer_) external onlyOwner {
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

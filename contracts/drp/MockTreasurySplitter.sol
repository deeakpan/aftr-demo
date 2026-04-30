// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

/// @dev Test helper for DRP fee routing; intentionally no-op.
contract MockTreasurySplitter {
    function distribute(address) external pure {}
}

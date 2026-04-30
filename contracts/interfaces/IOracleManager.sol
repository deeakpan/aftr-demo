// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IOracleManager {
    function getPrice(address token) external view returns (uint256);
}

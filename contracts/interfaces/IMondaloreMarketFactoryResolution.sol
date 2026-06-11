// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Factory hooks used by EVENT markets for community admin resolution.
interface IMondaloreMarketFactoryResolution {
    function isResolutionAdmin(address account) external view returns (bool);

    function resolutionThreshold() external view returns (uint256);
}

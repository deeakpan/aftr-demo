// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Factory hooks used by EVENT and NAD_TOKEN markets for resolution.
interface IMondaloreMarketFactoryResolution {
    function isResolutionAdmin(address account) external view returns (bool);

    function resolutionThreshold() external view returns (uint256);

    /// @notice Wallet allowed to resolve legacy NAD_TOKEN markets (typically the resolution bot).
    function nadResolutionAdmin() external view returns (address);

    /// @notice Wallet allowed to resolve Ponsfamily token markets (implemented as an alias to `nadResolutionAdmin` for backwards-compat).
    function ponsResolutionAdmin() external view returns (address);
}

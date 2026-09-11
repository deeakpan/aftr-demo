// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Factory hooks used by EVENT and TOKEN markets for resolution.
interface IZedkrMarketFactoryResolution {
    function isResolutionAdmin(address account) external view returns (bool);

    function resolutionThreshold() external view returns (uint256);

    /// @notice Wallet allowed to resolve TOKEN markets (Dexscreener / GeckoTerminal bot).
    function tokenResolutionAdmin() external view returns (address);

    /// @notice Wallet allowed to resolve legacy NAD_TOKEN markets (typically the resolution bot).
    function nadResolutionAdmin() external view returns (address);

    /// @notice Legacy alias for `tokenResolutionAdmin`.
    function ponsResolutionAdmin() external view returns (address);
}

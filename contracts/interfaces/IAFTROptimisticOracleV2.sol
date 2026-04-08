// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAFTROptimisticOracleV2
/// @notice UMA Optimistic Oracle V2 — event-style requests + settle (see UMA event-based prediction market tutorial).
interface IAFTROptimisticOracleV2 {
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        address currency,
        uint256 reward
    ) external returns (uint256 totalBond);

    /// @notice Proposer/disputer bond on top of final fee (call after `requestPrice` if non-default bond is needed).
    function setBond(bytes32 identifier, uint256 timestamp, bytes memory ancillaryData, uint256 bond)
        external
        returns (uint256 totalBond);

    function setCustomLiveness(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 customLiveness
    ) external;

    /// @notice Event-based request: evaluation time follows proposal, no TOO_EARLY, refund reward on dispute.
    function setEventBased(bytes32 identifier, uint256 timestamp, bytes memory ancillaryData) external;

    function settleAndGetPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external returns (int256 settledPrice);
}

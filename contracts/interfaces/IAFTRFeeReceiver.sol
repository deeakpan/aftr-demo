// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAFTRFeeReceiver
/// @notice Optional interface for fee recipients that want to receive fees via a hook
///         rather than a plain ERC20 transfer. If `feeRecipient` implements this interface,
///         the market will call `receiveFees(token, amount)` instead of transferring directly.
///         For native ETH fees, `receiveFees(address(0), amount)` is called with ETH attached.
interface IAFTRFeeReceiver {
    /// @notice Called by a market when protocol fees are ready.
    /// @param token  ERC20 token address, or address(0) for native ETH.
    /// @param amount Amount of fees being pushed.
    function receiveFees(address token, uint256 amount) external payable;
}

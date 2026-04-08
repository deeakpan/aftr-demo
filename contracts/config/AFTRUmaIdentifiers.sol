// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AFTRUmaIdentifiers
/// @notice OO v2 `priceIdentifier` values (`bytes32`). Must match UMA’s IdentifierWhitelist on your chain.
/// @dev Identifiers are UTF-8 in the high bytes of `bytes32` (Solidity string literal), matching UMA IdentifierWhitelist on Base Sepolia.
library AFTRUmaIdentifiers {
    /// @notice Binary yes/no (UMIP). Default for 2-outcome event markets when `umaIdentifier` is zero.
    bytes32 internal constant YES_OR_NO_QUERY = "YES_OR_NO_QUERY";

    /// @notice Multiple choice (UMIP-181). Default for 3+ outcome event markets when `umaIdentifier` is zero.
    /// Ancillary must be JSON per UMIP-181; option `value` strings should be `"0"`, `"1"`, … `"N-1"` so settlement maps to outcome indices.
    bytes32 internal constant MULTIPLE_CHOICE_QUERY = "MULTIPLE_CHOICE_QUERY";
}

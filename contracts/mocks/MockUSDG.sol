// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../token/USDG.sol";

/// @dev Deprecated alias — use `USDG` from `contracts/token/USDG.sol`.
contract MockUSDG is USDG {
    constructor(address initialOwner) USDG(initialOwner) {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title ZedkrCollateralRegistry
/// @notice Whitelist of ERC20 tokens usable as Zedkr FPMM collateral (e.g. USDG on Robinhood Chain).
contract ZedkrCollateralRegistry is Ownable2Step {
    mapping(address => bool) public isWhitelisted;

    event CollateralWhitelisted(address indexed token);
    event CollateralRevoked(address indexed token);

    error InvalidToken();
    error AlreadyWhitelisted();
    error NotWhitelisted();

    constructor(address owner_) Ownable(owner_) {}

    function whitelistCollateral(address token) external onlyOwner {
        if (token == address(0)) revert InvalidToken();
        if (isWhitelisted[token]) revert AlreadyWhitelisted();
        isWhitelisted[token] = true;
        emit CollateralWhitelisted(token);
    }

    function revokeCollateral(address token) external onlyOwner {
        if (!isWhitelisted[token]) revert NotWhitelisted();
        isWhitelisted[token] = false;
        emit CollateralRevoked(token);
    }
}

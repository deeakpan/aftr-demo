// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AFTRUSDC
/// @notice Test / internal USDC-style token: 6 decimals, owner-only mint. Initial supply minted to `initialOwner`.
contract AFTRUSDC is ERC20, Ownable {
    constructor(address initialOwner) ERC20("USD Coin", "USDC") Ownable(initialOwner) {
        _mint(initialOwner, 100_000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

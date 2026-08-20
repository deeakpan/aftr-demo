// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title USDG
/// @notice Mintable USD-pegged test collateral (6 decimals). Used as primary FPMM collateral on Zedkr.
contract USDG is ERC20, Ownable {
    constructor(address initialOwner) ERC20("USDG", "USDG") Ownable(initialOwner) {
        _mint(initialOwner, 100_000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint new USDG to `to`. Only the owner (deployer / ops wallet).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

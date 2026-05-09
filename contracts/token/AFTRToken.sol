// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title AFTRToken
/// @notice AFTR protocol governance / utility token.
///         18 decimals. Owner can mint (capped at MAX_SUPPLY).
///         Used as the staking token in AFTRFeeVault.
contract AFTRToken is ERC20, Ownable2Step {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 1 billion

    error MaxSupplyExceeded();

    constructor(address owner_, uint256 initialMint) ERC20("AFTR", "AFTR") Ownable(owner_) {
        if (initialMint > 0) {
            if (initialMint > MAX_SUPPLY) revert MaxSupplyExceeded();
            _mint(owner_, initialMint);
        }
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

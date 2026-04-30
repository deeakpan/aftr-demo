// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IUSDeAD.sol";

contract USDeAD is ERC20, Ownable, IUSDeAD {
    constructor(address initialOwner) ERC20("USDeAD", "USDeAD") Ownable(initialOwner) {}

    function mint(address to, uint256 amount) external override onlyOwner {
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external override onlyOwner {
        _burn(from, amount);
    }
}

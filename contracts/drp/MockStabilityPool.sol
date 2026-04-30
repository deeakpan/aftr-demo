// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal SP implementation for DRP integration tests.
contract MockStabilityPool is Ownable {
    using SafeERC20 for IERC20;

    address public immutable USDEAD;
    address public immutable WETH;
    address public immutable RETH;
    address public immutable WSTETH;
    address public DRP;

    uint256 public totalUSDeADDeposited;

    error SP__OnlyDRP();
    error SP__AddressZero();
    error SP__DRPAlreadySet();

    modifier onlyDRP() {
        if (msg.sender != DRP) revert SP__OnlyDRP();
        _;
    }

    constructor(
        address _usdead,
        address _weth,
        address _reth,
        address _wsteth,
        address _owner
    ) Ownable(_owner) {
        if (
            _usdead == address(0) ||
            _weth == address(0) ||
            _reth == address(0) ||
            _wsteth == address(0) ||
            _owner == address(0)
        ) revert SP__AddressZero();
        USDEAD = _usdead;
        WETH = _weth;
        RETH = _reth;
        WSTETH = _wsteth;
    }

    function setDRP(address _drp) external onlyOwner {
        if (DRP != address(0)) revert SP__DRPAlreadySet();
        if (_drp == address(0)) revert SP__AddressZero();
        DRP = _drp;
    }

    function provideToSP(uint256 amount) external {
        IERC20(USDEAD).safeTransferFrom(msg.sender, address(this), amount);
        totalUSDeADDeposited += amount;
    }

    function offset(
        address,
        uint256 debtToOffset,
        uint256
    ) external onlyDRP {
        if (debtToOffset > totalUSDeADDeposited) {
            debtToOffset = totalUSDeADDeposited;
        }
        totalUSDeADDeposited -= debtToOffset;
        IERC20(USDEAD).safeTransfer(DRP, debtToOffset);
    }

    function getTotalUSDeADDeposits() external view returns (uint256) {
        return totalUSDeADDeposited;
    }
}

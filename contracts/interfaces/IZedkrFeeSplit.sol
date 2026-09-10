// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Factory-held trade-fee recipients. Address(0) is allowed; markets route that share to the creator.
interface IZedkrFeeSplit {
    function platformDev() external view returns (address);
    function distribution() external view returns (address);
    function treasury() external view returns (address);
}

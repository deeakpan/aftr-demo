// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AFTRUmaAddresses
/// @notice UMA stack on **Base Sepolia** (chain ID 84532). Do not use on Base mainnet — addresses differ per network.
library AFTRUmaAddresses {
    address internal constant FINDER = 0xfF4Ec014E3CBE8f64a95bb022F1623C6e456F7dB;
    address internal constant ADDRESS_WHITELIST = 0xF2D5614BD8D6246AACa5a6841aCfCA210B0CbC19;
    address internal constant IDENTIFIER_WHITELIST = 0x4da2fD75dd26A8C8A0a8Db892019651344705836;
    address internal constant MOCK_ORACLE_ANCILLARY = 0x54e38A62ED3dC88e2B80cBA50deB940580511D26;
    address internal constant STORE = 0x0246FBF444cAe32867b410464664f8F02e1822C7;
    address internal constant TESTNET_ERC20 = 0x7E6d9618Ba8a87421609352d6e711958A97e2512;
    address internal constant OPTIMISTIC_ORACLE_V2 = 0x99EC530a761E68a377593888D9504002Bd191717;
    address internal constant OPTIMISTIC_ORACLE_V3 = 0x0F7fC5E6482f096380db6158f978167b57388deE;
}

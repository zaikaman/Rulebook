// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {UnsupportedChain} from "../shared/Errors.sol";

/// @title ChainConfig
/// @notice The only place in `contracts/src` where a chain address literal may appear.
/// @dev Verified constants from reactive docs and live RPC checks. Lasna (automation),
/// Unichain Sepolia (funds), and Base Sepolia (funds) are configured; every other chain ID
/// reverts `UnsupportedChain`.
library ChainConfig {
    uint256 internal constant LASNA = 5_318_007;
    uint256 internal constant UNICHAIN_SEPOLIA = 1301;
    uint256 internal constant BASE_SEPOLIA = 84_532;

    struct Config {
        uint256 chainId;
        address systemContract;
        address callbackProxy;
        address router;
        address weth;
        address usdc;
        address pair;
        address cronSource;
    }

    /// @notice Configuration for Reactive Lasna, the automation network.
    function lasna() internal pure returns (Config memory config) {
        config = Config({
            chainId: LASNA,
            systemContract: 0x8888888888888888888888888888888888888888,
            callbackProxy: 0x775c9B990ADe401060B78D0e98684eEf8d2466C1,
            router: 0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x31d0220469e10c4E71834a79b1f276d740d3768F,
            pair: 0x1d8698365321D6DcE1F7141c380C866b012eE9dA,
            cronSource: 0x0000000000000000000000000000000000fffFfF
        });
    }

    /// @notice Configuration for Unichain Sepolia, the funds network.
    function unichainSepolia() internal pure returns (Config memory config) {
        config = Config({
            chainId: UNICHAIN_SEPOLIA,
            systemContract: 0x8888888888888888888888888888888888888888,
            callbackProxy: 0x775c9B990ADe401060B78D0e98684eEf8d2466C1,
            router: 0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x31d0220469e10c4E71834a79b1f276d740d3768F,
            pair: 0x1d8698365321D6DcE1F7141c380C866b012eE9dA,
            cronSource: 0x0000000000000000000000000000000000fffFfF
        });
    }

    /// @notice Configuration for Base Sepolia, a funds and origin network.
    function baseSepolia() internal pure returns (Config memory config) {
        config = Config({
            chainId: BASE_SEPOLIA,
            systemContract: 0x8888888888888888888888888888888888888888,
            callbackProxy: 0x476F44b11F5C942c58f4c8E3d0300E5710743585,
            router: 0x1689E7B1F10000AE47eBfE339a4f69dECd19F602,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x036CbD53842c5426634e7929541eC2318f3dCF7e,
            pair: 0x0B9Ab53880be6fF805ebF8FBce515E5715ccE1bE,
            cronSource: 0x0000000000000000000000000000000000fffFfF
        });
    }

    /// @notice Returns the configuration for `chainId`.
    /// @dev Reverts with `UnsupportedChain` for any chain this release does not ship. The error
    /// keeps its canonical `uint16` parameter; UnknownChain values above `uint16` are reported
    /// truncated, which is acceptable because supported chains above `uint16` (Lasna and Base
    /// Sepolia) never reach this revert.
    function get(uint256 chainId) internal pure returns (Config memory config) {
        if (chainId == LASNA) return lasna();
        if (chainId == UNICHAIN_SEPOLIA) return unichainSepolia();
        if (chainId == BASE_SEPOLIA) return baseSepolia();
        revert UnsupportedChain(uint16(chainId));
    }

    /// @notice True when `chainId` is one of the configured chains.
    function isSupported(uint256 chainId) internal pure returns (bool supported) {
        supported = chainId == LASNA || chainId == UNICHAIN_SEPOLIA || chainId == BASE_SEPOLIA;
    }

    /// @notice True when `chainId` is a supported funds/settlement and origin chain.
    function isFundsChain(uint256 chainId) internal pure returns (bool supported) {
        supported = chainId == UNICHAIN_SEPOLIA || chainId == BASE_SEPOLIA;
    }
}

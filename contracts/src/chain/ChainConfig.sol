// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {UnsupportedChain} from "../shared/Errors.sol";

/// @title ChainConfig
/// @notice The only place in `contracts/src` where a chain address literal may appear.
/// @dev Verified constants from IDEA.md §22. Only Lasna (automation) and Unichain Sepolia
/// (funds) are configured; every other chain ID reverts `UnsupportedChain`.
library ChainConfig {
    uint256 internal constant LASNA = 5_318_007;
    uint256 internal constant UNICHAIN_SEPOLIA = 1301;

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

    /// @notice Returns the configuration for `chainId`.
    /// @dev Reverts with `UnsupportedChain` for any chain this release does not ship. The error
    /// keeps its canonical `uint16` parameter; UnknownChain values are therefore reported
    /// truncated, which is acceptable because no supported chain id exceeds `uint16` except
    /// Lasna itself (5318007), which never reaches this revert.
    function get(uint256 chainId) internal pure returns (Config memory config) {
        if (chainId == LASNA) return lasna();
        if (chainId == UNICHAIN_SEPOLIA) return unichainSepolia();
        revert UnsupportedChain(uint16(chainId));
    }

    /// @notice True when `chainId` is one of the configured chains.
    function isSupported(uint256 chainId) internal pure returns (bool supported) {
        supported = chainId == LASNA || chainId == UNICHAIN_SEPOLIA;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {UnsupportedChain} from "../shared/Errors.sol";

/// @title ChainConfig
/// @notice The only place in `contracts/src` where a chain address literal may appear.
/// @dev Verified constants from reactive docs and live RPC checks. Lasna and Reactive Mainnet
/// (automation) alongside Unichain Sepolia, Base Sepolia, Unichain Mainnet, and Base Mainnet
/// (funds) are configured; every other chain ID reverts `UnsupportedChain`.
library ChainConfig {
    uint256 internal constant LASNA = 5_318_007;
    uint256 internal constant UNICHAIN_SEPOLIA = 1301;
    uint256 internal constant BASE_SEPOLIA = 84_532;
    uint256 internal constant REACTIVE_MAINNET = 1597;
    uint256 internal constant UNICHAIN_MAINNET = 130;
    uint256 internal constant BASE_MAINNET = 8453;

    struct Config {
        uint256 chainId;
        address systemContract;
        address callbackProxy;
        address router;
        address weth;
        address usdc;
        address pair;
        uint24 poolFee;
        address cronSource;
        address ethUsdFeed;
        address usdcUsdFeed;
        address sequencerFeed;
        uint32 ethFeedMaxAge;
        uint32 usdcFeedMaxAge;
    }

    /// @notice Configuration for Reactive Lasna, the testnet automation network.
    function lasna() internal pure returns (Config memory config) {
        config = Config({
            chainId: LASNA,
            systemContract: 0x8888888888888888888888888888888888888888,
            callbackProxy: 0x775c9B990ADe401060B78D0e98684eEf8d2466C1,
            router: 0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x31d0220469e10c4E71834a79b1f276d740d3768F,
            pair: 0x1d8698365321D6DcE1F7141c380C866b012eE9dA,
            poolFee: 0,
            cronSource: 0x0000000000000000000000000000000000fffFfF,
            ethUsdFeed: address(0),
            usdcUsdFeed: address(0),
            sequencerFeed: address(0),
            ethFeedMaxAge: 0,
            usdcFeedMaxAge: 0
        });
    }

    /// @notice Configuration for Reactive Mainnet, the production automation network.
    function reactiveMainnet() internal pure returns (Config memory config) {
        config = Config({
            chainId: REACTIVE_MAINNET,
            systemContract: 0x8888888888888888888888888888888888888888,
            callbackProxy: address(0),
            router: address(0),
            weth: address(0),
            usdc: address(0),
            pair: address(0),
            poolFee: 0,
            cronSource: 0x0000000000000000000000000000000000fffFfF,
            ethUsdFeed: address(0),
            usdcUsdFeed: address(0),
            sequencerFeed: address(0),
            ethFeedMaxAge: 0,
            usdcFeedMaxAge: 0
        });
    }

    /// @notice Configuration for Unichain Sepolia, the testnet funds network.
    function unichainSepolia() internal pure returns (Config memory config) {
        config = Config({
            chainId: UNICHAIN_SEPOLIA,
            systemContract: 0x8888888888888888888888888888888888888888,
            callbackProxy: 0x775c9B990ADe401060B78D0e98684eEf8d2466C1,
            router: 0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x31d0220469e10c4E71834a79b1f276d740d3768F,
            pair: 0x1d8698365321D6DcE1F7141c380C866b012eE9dA,
            poolFee: 0,
            cronSource: 0x0000000000000000000000000000000000fffFfF,
            ethUsdFeed: address(0),
            usdcUsdFeed: address(0),
            sequencerFeed: address(0),
            ethFeedMaxAge: 0,
            usdcFeedMaxAge: 0
        });
    }

    /// @notice Configuration for Base Sepolia, a testnet funds and origin network.
    function baseSepolia() internal pure returns (Config memory config) {
        config = Config({
            chainId: BASE_SEPOLIA,
            systemContract: 0x8888888888888888888888888888888888888888,
            callbackProxy: 0x476F44b11F5C942c58f4c8E3d0300E5710743585,
            router: 0x1689E7B1F10000AE47eBfE339a4f69dECd19F602,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x036CbD53842c5426634e7929541eC2318f3dCF7e,
            pair: 0x0B9Ab53880be6fF805ebF8FBce515E5715ccE1bE,
            poolFee: 0,
            cronSource: 0x0000000000000000000000000000000000fffFfF,
            ethUsdFeed: address(0),
            usdcUsdFeed: address(0),
            sequencerFeed: address(0),
            ethFeedMaxAge: 0,
            usdcFeedMaxAge: 0
        });
    }

    /// @notice Configuration for Unichain Mainnet, a production funds network (Uniswap V3 0.30%).
    function unichainMainnet() internal pure returns (Config memory config) {
        config = Config({
            chainId: UNICHAIN_MAINNET,
            systemContract: address(0),
            callbackProxy: 0x754120EC7a6eF81E4c5c835AA603C63Da64693E6,
            router: 0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x078D782b760474a361dDA0AF3839290b0EF57AD6,
            pair: 0x8927058918e3CFf6F55EfE45A58db1be1F069E49,
            poolFee: 3_000,
            cronSource: address(0),
            ethUsdFeed: 0x41CFbbA7Be6E03fC43A19689b31852Af205da864,
            usdcUsdFeed: 0xbd1cD1518eFB92a92100da62D4C488c810dFd75b,
            sequencerFeed: 0x495639D9914e7D270c5dCC641BfB1d807423F813,
            ethFeedMaxAge: 90_000,
            usdcFeedMaxAge: 90_000
        });
    }

    /// @notice Configuration for Base Mainnet, a production funds and origin network.
    function baseMainnet() internal pure returns (Config memory config) {
        config = Config({
            chainId: BASE_MAINNET,
            systemContract: address(0),
            callbackProxy: 0xCc780DdE33f56f55dE778D42c930959374a4a068,
            router: 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24,
            weth: 0x4200000000000000000000000000000000000006,
            usdc: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,
            pair: 0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C,
            poolFee: 0,
            cronSource: address(0),
            ethUsdFeed: 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,
            usdcUsdFeed: 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B,
            sequencerFeed: 0xBCF85224fc0756B9Fa45aA7892530B47e10b6433,
            ethFeedMaxAge: 3_600,
            usdcFeedMaxAge: 90_000
        });
    }

    /// @notice Returns the configuration for `chainId`.
    /// @dev Reverts with `UnsupportedChain` for any chain this release does not ship. The error
    /// keeps its canonical `uint16` parameter; UnknownChain values above `uint16` are reported
    /// truncated, which is acceptable because supported chains above `uint16` (Lasna and Base
    /// Sepolia) never reach this revert.
    function get(uint256 chainId) internal pure returns (Config memory config) {
        if (chainId == LASNA) return lasna();
        if (chainId == REACTIVE_MAINNET) return reactiveMainnet();
        if (chainId == UNICHAIN_SEPOLIA) return unichainSepolia();
        if (chainId == BASE_SEPOLIA) return baseSepolia();
        if (chainId == UNICHAIN_MAINNET) return unichainMainnet();
        if (chainId == BASE_MAINNET) return baseMainnet();
        revert UnsupportedChain(uint16(chainId));
    }

    /// @notice True when `chainId` is one of the configured chains.
    function isSupported(uint256 chainId) internal pure returns (bool supported) {
        supported = isAutomationChain(chainId) || isFundsChain(chainId);
    }

    /// @notice True when `chainId` is an automation (Reactive) chain.
    function isAutomationChain(uint256 chainId) internal pure returns (bool supported) {
        supported = chainId == LASNA || chainId == REACTIVE_MAINNET;
    }

    /// @notice True when `chainId` is a supported testnet funds chain.
    function isTestnetFundsChain(uint256 chainId) internal pure returns (bool supported) {
        supported = chainId == UNICHAIN_SEPOLIA || chainId == BASE_SEPOLIA;
    }

    /// @notice True when `chainId` is a supported mainnet funds chain.
    function isMainnetFundsChain(uint256 chainId) internal pure returns (bool supported) {
        supported = chainId == UNICHAIN_MAINNET || chainId == BASE_MAINNET;
    }

    /// @notice True when `chainId` is a supported funds/settlement and origin chain.
    function isFundsChain(uint256 chainId) internal pure returns (bool supported) {
        supported = isTestnetFundsChain(chainId) || isMainnetFundsChain(chainId);
    }

    /// @notice True when `fundsChainId` belongs to the same environment as `automationChainId`.
    function isFundsChainFor(uint256 automationChainId, uint256 fundsChainId)
        internal
        pure
        returns (bool supported)
    {
        if (automationChainId == REACTIVE_MAINNET) return isMainnetFundsChain(fundsChainId);
        if (automationChainId == LASNA) return isTestnetFundsChain(fundsChainId);
        return false;
    }
}

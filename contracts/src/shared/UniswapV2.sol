// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice The subset of a Uniswap V2 pair the Vault reads: token order and live reserves.
interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

/// @notice The subset of Uniswap V2 Router02 the Vault calls.
interface IUniswapV2Router02 {
    function factory() external view returns (address);
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

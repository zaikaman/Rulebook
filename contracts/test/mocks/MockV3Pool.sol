// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IUniswapV3Pool} from "../../src/shared/UniswapV3.sol";

/// @notice Uniswap V3 pool double with settable `slot0`/`liquidity` and a real `Swap` event.
contract MockV3Pool is IUniswapV3Pool {
    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );

    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    uint160 private _sqrtPriceX96;
    uint128 private _liquidity;
    int24 private _tick;

    constructor(address token0_, address token1_, uint24 fee_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
    }

    function setPrice(uint160 sqrtPriceX96_, uint128 liquidity_) external {
        _sqrtPriceX96 = sqrtPriceX96_;
        _liquidity = liquidity_;
        emit Swap(msg.sender, msg.sender, 0, 0, sqrtPriceX96_, liquidity_, _tick);
    }

    function liquidity() external view returns (uint128) {
        return _liquidity;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (_sqrtPriceX96, _tick, 0, 1, 1, 0, true);
    }
}

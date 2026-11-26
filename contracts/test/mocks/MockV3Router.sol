// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Factory, IV3SwapRouter} from "../../src/shared/UniswapV3.sol";

/// @notice SwapRouter02 & V3 factory double for `exactInputSingle` settlement tests.
contract MockV3Router is IV3SwapRouter, IUniswapV3Factory {
    struct Swap {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountIn;
        uint256 amountOutMinimum;
        address recipient;
    }

    Swap public lastSwap;
    uint256 public swapCount;

    address private _tokenA;
    address private _tokenB;
    uint24 private _fee;
    address private _pool;

    bool private _useForcedOut;
    uint256 private _forcedOut;
    bool private _bypassMinOut;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        _tokenA = tokenA;
        _tokenB = tokenB;
        _fee = fee;
        _pool = pool;
    }

    function setForcedOut(bool enabled, uint256 amountOut, bool bypassMinOut) external {
        _useForcedOut = enabled;
        _forcedOut = amountOut;
        _bypassMinOut = bypassMinOut;
    }

    function factory() external view returns (address) {
        return address(this);
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        if (
            fee == _fee
                && ((tokenA == _tokenA && tokenB == _tokenB)
                    || (tokenA == _tokenB && tokenB == _tokenA))
        ) {
            return _pool;
        }
        return address(0);
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        amountOut = _useForcedOut ? _forcedOut : params.amountOutMinimum;
        if (!_bypassMinOut) require(amountOut >= params.amountOutMinimum, "Too little received");
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
        lastSwap = Swap(
            params.tokenIn,
            params.tokenOut,
            params.fee,
            params.amountIn,
            params.amountOutMinimum,
            params.recipient
        );
        swapCount += 1;
    }
}

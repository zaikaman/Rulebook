// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PriceMath} from "../../libraries/PriceMath.sol";
import {IUniswapV2Factory, IUniswapV2Pair, IUniswapV2Router02} from "../../shared/UniswapV2.sol";

/// @notice Settlement-chain reads and protocol calls. External money destinations are pinned at deployment.
abstract contract WorkflowProtocolsV2 {
    using SafeERC20 for IERC20;

    struct Networks {
        address usdc;
        address weth;
        address router;
        address pair;
    }

    error InvalidMarket();
    error NoLongerEligible();

    address public immutable usdc;
    address public immutable weth;
    address public immutable router;
    address public immutable pair;

    constructor(Networks memory cfg) {
        if (cfg.usdc == address(0)) revert InvalidMarket();
        usdc = cfg.usdc;
        weth = cfg.weth;
        router = cfg.router;
        pair = cfg.pair;
    }

    function _reserves() internal view returns (uint112 stable, uint112 wrapped) {
        if (pair == address(0)) revert InvalidMarket();
        IUniswapV2Pair pool = IUniswapV2Pair(pair);
        (uint112 first, uint112 second,) = pool.getReserves();
        return pool.token0() == usdc ? (first, second) : (second, first);
    }

    function _price() internal view returns (uint256) {
        (uint112 stable, uint112 wrapped) = _reserves();
        if (stable == 0 || wrapped == 0) revert InvalidMarket();
        return PriceMath.usdcPerWeth(stable, wrapped);
    }

    function _swap(bool sell, uint256 amount, uint16 slippage, uint64 expiresAt)
        internal
        returns (uint256 received)
    {
        IUniswapV2Router02 exchange = IUniswapV2Router02(router);
        if (IUniswapV2Factory(exchange.factory()).getPair(usdc, weth) != pair) {
            revert InvalidMarket();
        }
        (uint112 stable, uint112 wrapped) = _reserves();
        uint256 quote = sell
            ? PriceMath.expectedOut(amount, wrapped, stable)
            : PriceMath.expectedOut(amount, stable, wrapped);
        uint256 floor = PriceMath.applySlippage(quote, slippage);
        if (floor == 0) revert InvalidMarket();
        address[] memory path = new address[](2);
        (path[0], path[1]) = sell ? (weth, usdc) : (usdc, weth);
        IERC20 token = IERC20(path[0]);
        token.forceApprove(router, amount);
        uint256[] memory amounts =
            exchange.swapExactTokensForTokens(amount, floor, path, address(this), expiresAt);
        token.forceApprove(router, 0);
        return amounts[1];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Router02 double that moves pre-funded tokens for an exact-output fixture.
contract MockRouter {
    /// @notice Last swap arguments, for assertions.
    struct Swap {
        uint256 amountIn;
        uint256 amountOutMin;
        address to;
        uint256 deadline;
    }

    Swap public lastSwap;
    uint256 public swapCount;

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(path.length == 2, "path");
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        IERC20(path[1]).transfer(to, amountOutMin);
        lastSwap = Swap(amountIn, amountOutMin, to, deadline);
        swapCount += 1;
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOutMin;
    }
}

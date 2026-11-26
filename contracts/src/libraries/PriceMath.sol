// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {InvalidAmount, InvalidSecondary} from "../shared/Errors.sol";

/// @title PriceMath
/// @notice Pure reserve→price, quote, and scaling helpers shared by the Agent, the Vault, and tests.
/// @dev Prices are always scaled by 1e18. Every rounding step rounds down.
library PriceMath {
    /// @notice Scale applied to every price produced or consumed by a rule.
    uint256 internal constant PRICE_SCALE = 1e18;
    uint256 private constant USDC_PER_WETH_SCALE = 1e30;

    /// @notice Basis-point denominator.
    uint256 internal constant BPS = 10_000;

    /// @notice Fee-tier denominator in parts per million (Uniswap V3 convention).
    uint256 internal constant FEE_PPM_DENOMINATOR = 1_000_000;
    uint24 internal constant V2_FEE_PPM = 3_000;

    /// @notice Uniswap V3 sqrtRatio bounds from TickMath.
    uint160 internal constant MIN_SQRT_RATIO = 4_295_128_739;
    uint160 internal constant MAX_SQRT_RATIO =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;
    uint256 private constant Q96 = 1 << 96;
    uint256 private constant Q192 = 1 << 192;

    /// @notice Uniswap V2 fee, expressed on the 1000-scaled input amount.
    uint256 internal constant FEE_NUMERATOR = 997;
    uint256 internal constant FEE_DENOMINATOR = 1000;

    /// @notice Derives the quote-token price of one base token, scaled by 1e18.
    /// @param reserveBase Reserve of the token being priced.
    /// @param reserveQuote Reserve of the token the price is quoted in.
    /// @return price Quote tokens per base token, scaled by 1e18.
    function priceFromReserves(uint256 reserveBase, uint256 reserveQuote)
        internal
        pure
        returns (uint256 price)
    {
        if (reserveBase == 0 || reserveQuote == 0) revert InvalidAmount();
        price = (reserveQuote * PRICE_SCALE) / reserveBase;
    }

    /// @notice USDC per WETH at 1e18 precision, accounting for 6 vs. 18 decimals.
    function usdcPerWeth(uint112 usdcReserve, uint112 wethReserve) internal pure returns (uint256) {
        if (usdcReserve == 0 || wethReserve == 0) revert InvalidAmount();
        return (uint256(usdcReserve) * USDC_PER_WETH_SCALE) / wethReserve;
    }

    /// @notice USDC per WETH at 1e18 precision from a Uniswap V3 `sqrtPriceX96`.
    /// @dev Uses exact Q192 arithmetic when `sqrtPriceX96 <= type(uint128).max` and chained Q96
    /// scaling otherwise so `uint256(sqrtPriceX96) * sqrtPriceX96` never overflows.
    function usdcPerWethFromSqrtPriceX96(uint160 sqrtPriceX96, bool usdcIsToken0)
        internal
        pure
        returns (uint256 price)
    {
        if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
            revert InvalidAmount();
        }
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
            price = usdcIsToken0
                ? Math.mulDiv(Q192, USDC_PER_WETH_SCALE, ratioX192)
                : Math.mulDiv(ratioX192, USDC_PER_WETH_SCALE, Q192);
        } else if (usdcIsToken0) {
            uint256 step = Math.mulDiv(Q96, USDC_PER_WETH_SCALE, sqrtPriceX96);
            price = Math.mulDiv(step, Q96, sqrtPriceX96);
        } else {
            uint256 step = Math.mulDiv(sqrtPriceX96, USDC_PER_WETH_SCALE, Q96);
            price = Math.mulDiv(step, sqrtPriceX96, Q96);
        }
    }

    function movedBy(uint256 price, uint256 referencePrice, uint256 bps)
        internal
        pure
        returns (bool)
    {
        uint256 delta = price >= referencePrice ? price - referencePrice : referencePrice - price;
        return delta >= Math.mulDiv(referencePrice, bps, BPS, Math.Rounding.Ceil);
    }

    /// @notice Constant-product output for `amountIn`, including the 0.30% pool fee.
    /// @dev Mirrors Uniswap V2 `getAmountOut`; rounds down, so the caller never overstates output.
    function expectedOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256 amountOut)
    {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) revert InvalidAmount();
        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }

    /// @notice Expected swap output valued at `usdcPerWethPrice` (1e18), net of `feePpm` pool fee.
    /// @dev Rounds down at each step so an unmanipulated pool satisfies the resulting floor.
    function quotedOut(bool sell, uint256 amountIn, uint256 usdcPerWethPrice, uint24 feePpm)
        internal
        pure
        returns (uint256 amountOut)
    {
        if (amountIn == 0 || usdcPerWethPrice == 0) revert InvalidAmount();
        if (feePpm >= FEE_PPM_DENOMINATOR) revert InvalidSecondary();
        uint256 grossOut = sell
            ? Math.mulDiv(amountIn, usdcPerWethPrice, USDC_PER_WETH_SCALE)
            : Math.mulDiv(amountIn, USDC_PER_WETH_SCALE, usdcPerWethPrice);
        amountOut = Math.mulDiv(grossOut, FEE_PPM_DENOMINATOR - feePpm, FEE_PPM_DENOMINATOR);
    }

    /// @notice Expected swap output valued at an external `usdcPerWethPrice` (1e18), net of the 0.30% V2 fee.
    /// @dev Rounds down at each step so an unmanipulated pool satisfies the resulting floor.
    function oracleExpectedOut(bool sell, uint256 amountIn, uint256 usdcPerWethPrice)
        internal
        pure
        returns (uint256 amountOut)
    {
        return quotedOut(sell, amountIn, usdcPerWethPrice, V2_FEE_PPM);
    }

    /// @notice Applies a slippage tolerance, rounding down.
    /// @param amount The reference output.
    /// @param slippageBps Tolerance in basis points; must not exceed 10,000.
    function applySlippage(uint256 amount, uint256 slippageBps)
        internal
        pure
        returns (uint256 minimumOut)
    {
        if (slippageBps > BPS) revert InvalidSecondary();
        minimumOut = (amount * (BPS - slippageBps)) / BPS;
    }

    /// @notice Scales `amount` by `scaleBps`, rounding down.
    /// @dev Used for mirrored (proportional) execution sizes.
    function scaleAmount(uint256 amount, uint256 scaleBps) internal pure returns (uint256 scaled) {
        if (scaleBps > BPS) revert InvalidSecondary();
        scaled = (amount * scaleBps) / BPS;
    }
}

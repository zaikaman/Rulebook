// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

import {PriceMath} from "../../src/libraries/PriceMath.sol";
import {InvalidAmount, InvalidSecondary} from "../../src/shared/Errors.sol";

contract PriceMathHarness {
    function priceFromReserves(uint256 base, uint256 quote) external pure returns (uint256) {
        return PriceMath.priceFromReserves(base, quote);
    }

    function expectedOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        external
        pure
        returns (uint256)
    {
        return PriceMath.expectedOut(amountIn, reserveIn, reserveOut);
    }

    function applySlippage(uint256 amount, uint256 bps) external pure returns (uint256) {
        return PriceMath.applySlippage(amount, bps);
    }

    function scaleAmount(uint256 amount, uint256 bps) external pure returns (uint256) {
        return PriceMath.scaleAmount(amount, bps);
    }

    function oracleExpectedOut(bool sell, uint256 amountIn, uint256 usdcPerWethPrice)
        external
        pure
        returns (uint256)
    {
        return PriceMath.oracleExpectedOut(sell, amountIn, usdcPerWethPrice);
    }

    function usdcPerWethFromSqrtPriceX96(uint160 sqrtPriceX96, bool usdcIsToken0)
        external
        pure
        returns (uint256)
    {
        return PriceMath.usdcPerWethFromSqrtPriceX96(sqrtPriceX96, usdcIsToken0);
    }

    function quotedOut(bool sell, uint256 amountIn, uint256 usdcPerWethPrice, uint24 feePpm)
        external
        pure
        returns (uint256)
    {
        return PriceMath.quotedOut(sell, amountIn, usdcPerWethPrice, feePpm);
    }
}

contract PriceMathTest is Test {
    PriceMathHarness internal harness;

    function setUp() public {
        harness = new PriceMathHarness();
    }

    function test_priceFromReservesScalesBy1e18() public pure {
        assertEq(PriceMath.priceFromReserves(1e18, 1_500e18), 1_500e18);
        assertEq(PriceMath.priceFromReserves(4, 10), 2.5e18);
    }

    function test_priceFromReservesRevertsOnZeroReserve() public {
        vm.expectRevert(InvalidAmount.selector);
        harness.priceFromReserves(0, 1);
    }

    function test_expectedOutMatchesConstantProduct() public pure {
        uint256 amountOut = PriceMath.expectedOut(1_000e6, 1_000_000e6, 1_000e18);
        assertApproxEqAbs(amountOut, 996_006_981_039_903_216, 1e6);
    }

    function test_expectedOutRevertsOnEmptyPool() public {
        vm.expectRevert(InvalidAmount.selector);
        harness.expectedOut(1e6, 0, 1e18);
    }

    function test_applySlippageRoundsDown() public pure {
        assertEq(PriceMath.applySlippage(1_000, 50), 995);
        assertEq(PriceMath.applySlippage(1, 1), 0);
    }

    function test_applySlippageRejectsOutOfRange() public {
        vm.expectRevert(InvalidSecondary.selector);
        harness.applySlippage(1_000, 10_001);
    }

    function test_scaleAmountRoundsDown() public pure {
        assertEq(PriceMath.scaleAmount(3, 5_000), 1);
        assertEq(PriceMath.scaleAmount(1_000, 10_000), 1_000);
    }

    function test_scaleAmountRejectsOutOfRange() public {
        vm.expectRevert(InvalidSecondary.selector);
        harness.scaleAmount(1_000, 10_001);
    }

    function test_movedByChecksBothDirectionsAndCeilingRounding() public pure {
        assertFalse(PriceMath.movedBy(1_000, 1_000, 100));
        assertTrue(PriceMath.movedBy(1_010, 1_000, 100));
        assertTrue(PriceMath.movedBy(990, 1_000, 100));
        assertFalse(PriceMath.movedBy(1_009, 1_000, 100));
        // Ceiling rounding: 1001 * 100 / 10000 = 10.01 -> ceil = 11; delta 10 < 11.
        assertFalse(PriceMath.movedBy(1_011, 1_001, 100));
        assertTrue(PriceMath.movedBy(1_012, 1_001, 100));
    }

    function test_oracleExpectedOutMatchesBuyAndSellWithFeeAndRoundingDown() public pure {
        // At $2,000 / WETH (2_000e18):
        // Selling 1 WETH -> 2,000 USDC * 997 / 1000 = 1,994 USDC (1_994e6).
        assertEq(PriceMath.oracleExpectedOut(true, 1 ether, 2_000e18), 1_994e6);
        // Buying with 2,000 USDC -> 1 WETH * 997 / 1000 = 0.997 WETH.
        assertEq(PriceMath.oracleExpectedOut(false, 2_000e6, 2_000e18), 0.997 ether);
        // Rounds down on fractional output.
        assertEq(PriceMath.oracleExpectedOut(true, 1, 2_000e18), 0);
    }

    function test_oracleExpectedOutRevertsOnZeroInputs() public {
        vm.expectRevert(InvalidAmount.selector);
        harness.oracleExpectedOut(true, 0, 2_000e18);
        vm.expectRevert(InvalidAmount.selector);
        harness.oracleExpectedOut(false, 1_000e6, 0);
    }

    function testFuzz_oracleExpectedOut(bool sell, uint96 amountIn, uint96 price) public pure {
        uint256 boundedAmount = bound(uint256(amountIn), 1, type(uint96).max);
        uint256 boundedPrice = bound(uint256(price), 1e12, 1_000_000e18);
        uint256 out = PriceMath.oracleExpectedOut(sell, boundedAmount, boundedPrice);
        uint256 expectedUpper =
            sell ? (boundedAmount * boundedPrice) / 1e30 : (boundedAmount * 1e30) / boundedPrice;
        assertLe(out, expectedUpper);
    }

    function test_usdcPerWethFromSqrtPriceX96BothTokenOrders() public pure {
        // Real Unichain Mainnet V3 0.30% pool (USDC is token0, WETH is token1) around $1,700/WETH:
        // sqrtPriceX96 = 1_921_992_093_666_375_242_676_522_292_903_936 -> ~$1,699.24/WETH.
        uint160 uniSqrt = 1_921_992_093_666_375_242_676_522_292_903_936;
        uint256 uniPrice = PriceMath.usdcPerWethFromSqrtPriceX96(uniSqrt, true);
        assertApproxEqRel(uniPrice, 1_699.24e18, 1e14);

        // Inverted token order (WETH is token0, USDC is token1, e.g. Base):
        // sqrtPriceX96 = 2^96 * sqrt(1_700 / 1e12) = 3_266_536_708_906_610_409_472_000.
        uint160 baseSqrt = 3_266_536_708_906_610_409_472_000;
        uint256 basePrice = PriceMath.usdcPerWethFromSqrtPriceX96(baseSqrt, false);
        assertApproxEqRel(basePrice, 1_700e18, 1e14);

        // Exercises the > type(uint128).max chained-Q96 branch for both token orders.
        uint160 largeSqrt = uint160(type(uint128).max) + 1;
        uint256 highPriceFalse = PriceMath.usdcPerWethFromSqrtPriceX96(largeSqrt, false);
        assertGt(highPriceFalse, 0);
        // At MIN_SQRT_RATIO with usdcIsToken0=true, price is huge; with false, rounds to 0.
        assertGt(PriceMath.usdcPerWethFromSqrtPriceX96(PriceMath.MIN_SQRT_RATIO, true), 0);
        assertEq(PriceMath.usdcPerWethFromSqrtPriceX96(PriceMath.MIN_SQRT_RATIO, false), 0);
        // Exercises > uint128.max with usdcIsToken0=true at MAX_SQRT_RATIO - 1.
        assertEq(PriceMath.usdcPerWethFromSqrtPriceX96(PriceMath.MAX_SQRT_RATIO - 1, true), 0);
    }

    function test_usdcPerWethFromSqrtPriceX96RevertsOutOfRange() public {
        vm.expectRevert(InvalidAmount.selector);
        harness.usdcPerWethFromSqrtPriceX96(PriceMath.MIN_SQRT_RATIO - 1, true);
        vm.expectRevert(InvalidAmount.selector);
        harness.usdcPerWethFromSqrtPriceX96(PriceMath.MAX_SQRT_RATIO, false);
    }

    function test_quotedOutSupportsAllFeeTiersAndRejectsInvalidFee() public {
        // 0.05% tier (500 ppm) at $2,000/WETH: 1 WETH -> 1,999 USDC; 2,000 USDC -> 0.9995 WETH.
        assertEq(PriceMath.quotedOut(true, 1 ether, 2_000e18, 500), 1_999e6);
        assertEq(PriceMath.quotedOut(false, 2_000e6, 2_000e18, 500), 0.9995 ether);
        // 0.30% tier (3000 ppm) matches oracleExpectedOut.
        assertEq(
            PriceMath.quotedOut(true, 1 ether, 2_000e18, 3_000),
            PriceMath.oracleExpectedOut(true, 1 ether, 2_000e18)
        );
        // 1.00% tier (10000 ppm).
        assertEq(PriceMath.quotedOut(true, 1 ether, 2_000e18, 10_000), 1_980e6);

        vm.expectRevert(InvalidAmount.selector);
        harness.quotedOut(true, 0, 2_000e18, 3_000);
        vm.expectRevert(InvalidAmount.selector);
        harness.quotedOut(false, 1_000e6, 0, 3_000);
        vm.expectRevert(InvalidSecondary.selector);
        harness.quotedOut(true, 1 ether, 2_000e18, 1_000_000);
    }

    function testFuzz_usdcPerWethFromSqrtPriceX96(uint160 sqrtPriceX96, bool usdcIsToken0)
        public
        pure
    {
        uint160 bounded = uint160(
            bound(
                uint256(sqrtPriceX96),
                uint256(PriceMath.MIN_SQRT_RATIO),
                uint256(PriceMath.MAX_SQRT_RATIO) - 1
            )
        );
        // Should never overflow or revert for any valid TickMath sqrtRatio.
        PriceMath.usdcPerWethFromSqrtPriceX96(bounded, usdcIsToken0);
    }
}

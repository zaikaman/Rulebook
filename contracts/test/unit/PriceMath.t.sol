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
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 1 — DCA: every schedule, buy tokenOut with tokenIn.
contract T01_DCATest is TemplateTestBase {
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 1;
        rule.chainId = uint16(CHAIN);
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.tokenOut = address(weth);
        rule.amountIn = 10e6;
        rule.secondary = 1 days; // schedule
    }

    function test_firesOnADueCronTick() public {
        _react(_tick());
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1, "one callback request per fire");
    }

    function test_doesNotFireTwiceInsideTheSameWindow() public {
        _react(_tick());
        _react(_tick());
        assertEq(_runs(ruleId), 1, "one window, one execution");
        assertEq(_requestCount(), 1);
    }

    function test_doesNotFireOnAPriceSync() public {
        _react(_syncPrice(2e18));
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }
}

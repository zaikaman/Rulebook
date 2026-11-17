// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 4 — take profit: above the target price, before expiry.
contract T04_TakeProfitTest is TemplateTestBase {
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 4;
        rule.chainId = uint16(CHAIN);
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.tokenOut = address(weth);
        rule.amountIn = 10e6;
        rule.threshold = 2e18;
        rule.secondary = block.timestamp + 1 days;
    }

    function test_firesWhenThePriceIsAboveTheTarget() public {
        _react(_syncPrice(2.5e18));
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);
    }

    function test_doesNotFireBelowTheTarget() public {
        _react(_syncPrice(1.9e18));
        assertEq(_runs(ruleId), 0);
    }

    function test_doesNotFireAfterExpiry() public {
        vm.warp(block.timestamp + 2 days);
        _react(_syncPrice(3e18));
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }
}

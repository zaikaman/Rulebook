// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 5 — stop loss, optionally trailing a percentage below the high.
contract T05_StopLossTest is TemplateTestBase {
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        ruleId = _add(_rule(2_000)); // 20% trailing tolerance
    }

    function _rule(uint256 trailingBps) internal view returns (RuleLib.Rule memory rule) {
        rule.template = 5;
        rule.chainId = uint16(CHAIN);
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.tokenOut = address(weth);
        rule.amountIn = 10e6;
        rule.threshold = 1e18;
        rule.secondary = trailingBps;
    }

    function test_firesWhenThePriceFallsBelowTheStop() public {
        _react(_syncPrice(2e18)); // high water
        _react(_syncPrice(1.5e18)); // 25% below the high, past the 20% trail
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);
    }

    function test_doesNotFireInsideTheTrailingBand() public {
        _react(_syncPrice(2e18));
        _react(_syncPrice(1.7e18)); // 15% below the high
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }

    function test_trailingStopUsesTheHighWater() public {
        uint256 plain = _add(_rule(0));
        _react(_syncPrice(2e18)); // the high water for both rules
        _react(_syncPrice(1.5e18)); // above the hard stop, below the 20% trail
        assertEq(_runs(plain), 0, "the hard stop has not been reached");
        assertEq(_runs(ruleId), 1, "the trailing stop follows the high");
    }
}

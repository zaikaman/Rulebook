// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 2 — dip-boost DCA: the schedule fires, but only after a dip.
contract T02_DipBoostDCATest is TemplateTestBase {
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 2;
        rule.chainId = uint16(CHAIN);
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.tokenOut = address(weth);
        rule.amountIn = 10e6;
        rule.threshold = 1 hours; // schedule
        rule.secondary = 500; // 5% dip
    }

    function test_firesOnACronTickAfterADip() public {
        _react(_syncPrice(2e18));
        _react(_syncPrice(1e18)); // 50% below the previous observation
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);
    }

    function test_doesNotFireWithoutADip() public {
        _react(_syncPrice(2e18));
        _react(_syncPrice(2.05e18)); // the price rose
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }

    function test_doesNotFireTwiceInTheSameWindow() public {
        _react(_syncPrice(2e18));
        _react(_syncPrice(1e18));
        _react(_tick(HOURLY_CRON_TOPIC));
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);
    }

    function test_requiresTwoRecentObservationsAndConsumesTheDipOnce() public {
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(ruleId), 0);
        _react(_syncPrice(2e18));
        _react(_syncPrice(1e18));
        _react(_tick(HOURLY_CRON_TOPIC));
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(ruleId), 1);

        _react(_syncPrice(2e18));
        _react(_syncPrice(1e18));
        vm.warp(vm.getBlockTimestamp() + 1 hours + 1);
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(ruleId), 1, "the next dip aged out instead of triggering a stale trade");
    }
}

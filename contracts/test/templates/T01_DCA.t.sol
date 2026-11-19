// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

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

    function test_hourlyRuleUsesLasnaCron100AndSkipsMissedSlots() public {
        RuleLib.Rule memory rule = _rule();
        rule.secondary = 1 hours;
        uint256 hourlyId = _add(rule);

        IReactive.LogRecord memory wrong = _tick(HOURLY_CRON_TOPIC);
        wrong.chain_id = CHAIN;
        _react(wrong);
        assertEq(_runs(hourlyId), 0);
        uint256 first = block.timestamp;
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(hourlyId), 1);

        vm.warp(first + 3 hours + 30 seconds);
        _react(_tick(HOURLY_CRON_TOPIC));
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(hourlyId), 2);
        vm.warp(first + 4 hours);
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(hourlyId), 3);
    }

    function test_respectsTheMonthlySpendLimit() public {
        RuleLib.Rule memory rule = _rule();
        rule.amountIn = agent.MAX_SPEND_PER_RUN();
        uint256 cappedId = _add(rule);
        vm.prank(USER);
        agent.pauseRule(ruleId);
        uint256 start = vm.getBlockTimestamp();
        for (uint256 i = 0; i < 5; ++i) {
            vm.warp(start + i * 1 days);
            _react(_tick());
        }
        assertEq(_runs(cappedId), 3);
        assertEq(agent.monthlySpent(), agent.MONTHLY_SPEND_CAP());
    }

    function test_aLateReplayOfAnOldTickDoesNotOpenAnotherSlot() public {
        IReactive.LogRecord memory first = _tick();
        _react(first);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        _react(first);
        assertEq(_runs(ruleId), 1);
        _react(_tick());
        assertEq(_runs(ruleId), 2);
    }
}

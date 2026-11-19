// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {CooldownActive} from "../../src/shared/Errors.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 6 — grid rebalance: a band move away from the reference price.
contract T06_GridRebalanceTest is TemplateTestBase {
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 6;
        rule.chainId = uint16(CHAIN);
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.tokenOut = address(weth);
        rule.amountIn = 10e6;
        rule.threshold = 2e18; // reference price
        rule.secondary = 1_000; // 10% band
    }

    function test_firesWhenThePriceMovesTheBandAway() public {
        _react(_syncPrice(2.3e18)); // 15% above the 2.0 reference
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);
    }

    function test_resetsTheReferenceAfterAFill() public {
        _react(_syncPrice(2.3e18));
        assertEq(agent.getHighWater(ruleId), 0, "requesting a swap must not move the grid");
        IReactive.LogRecord memory settlement =
            _log(VAULT, keccak256("GridSettled(uint256,uint32)"), "");
        settlement.topic_1 = ruleId;
        settlement.topic_2 = 2;
        _react(settlement);
        assertEq(agent.getHighWater(ruleId), 0, "different execution sequence");
        settlement.topic_2 = 1;
        _react(settlement);
        _react(_syncPrice(2.4e18)); // 4% above the new 2.3 reference
        assertEq(_runs(ruleId), 1);
        assertEq(agent.getHighWater(ruleId), 2.3e18);
        _react(_syncPrice(3e18));
        assertEq(_runs(ruleId), 2, "a new move can trigger a second swap");
    }

    function test_doesNotFireInsideTheBand() public {
        _react(_syncPrice(2.05e18));
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }

    function test_recordsAnInFlightSettlementWhilePaused() public {
        _react(_syncPrice(2.3e18));
        vm.prank(USER);
        agent.pauseRule(ruleId);
        assertEq(system.unsubscribeCount(), 1);
        IReactive.LogRecord memory settlement =
            _log(VAULT, keccak256("GridSettled(uint256,uint32)"), "");
        settlement.topic_1 = ruleId;
        settlement.topic_2 = 1;
        _react(settlement);
        assertEq(system.unsubscribeCount(), 2);
        assertEq(agent.getHighWater(ruleId), 2.3e18);
        vm.prank(USER);
        agent.resumeRule(ruleId);
        _react(_syncPrice(3e18));
        assertEq(_runs(ruleId), 2);
    }

    function test_rearmWaitsUntilTheOldCallbackExpires() public {
        _react(_syncPrice(2.3e18));
        vm.prank(USER);
        agent.pauseRule(ruleId);
        vm.prank(USER);
        vm.expectPartialRevert(CooldownActive.selector);
        agent.resetRule(ruleId);
        vm.warp(vm.getBlockTimestamp() + 10 minutes + 1);
        vm.prank(USER);
        agent.resetRule(ruleId);
        assertEq(system.unsubscribeCount(), 2);
        assertEq(agent.getHighWater(ruleId), 0);
    }

    function test_resumingBeforeSettlementDoesNotDuplicateTheReceiptFeed() public {
        _react(_syncPrice(2.3e18));
        vm.startPrank(USER);
        agent.pauseRule(ruleId);
        agent.resumeRule(ruleId);
        vm.stopPrank();
        assertEq(system.subscribeCount(), 3);
    }
}

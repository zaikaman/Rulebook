// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {IRuleRegistry} from "../../src/registry/IRuleRegistry.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {
    ExceedsPerRunCap,
    InvalidTemplateParams,
    MonthlyCapExceeded,
    NotOwner,
    NotServiceProvider,
    RuleNotActive
} from "../../src/shared/Errors.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

/// @notice User Story 4: pause/resume/cancel, reorder, the gas guard, and budget accounting.
contract AgentControlTest is Test {
    address internal constant USER = address(0xA11CE);
    address internal constant STRANGER = address(0xB0B);

    bytes32 internal constant EVALUATION_DEFERRED_TOPIC = keccak256("EvaluationDeferred(uint256,uint256)");
    bytes32 internal constant BUDGET_LOW_TOPIC = keccak256("BudgetLow(uint256,uint256)");

    MockSystemContract internal system;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockPair internal pair;
    Agent internal agent;

    function setUp() public {
        system = new MockSystemContract();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pair = new MockPair(address(usdc), address(weth));
        agent = new Agent(USER, IReactiveSystem(address(system)), IRuleRegistry(address(0)), address(this));
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 1;
        rule.chainId = 1301;
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.tokenOut = address(weth);
        rule.amountIn = 10e6;
    }

    function _alertRule(uint256 threshold) internal view returns (RuleLib.Rule memory rule) {
        rule.template = 11;
        rule.chainId = 1301;
        rule.pair = address(pair);
        rule.threshold = threshold;
    }

    function _addRule() internal returns (uint256 ruleId) {
        vm.prank(USER);
        ruleId = agent.addRule(_rule(), false);
    }

    function _addAlert(uint256 threshold) internal returns (uint256 ruleId) {
        vm.prank(USER);
        ruleId = agent.addRule(_alertRule(threshold), false);
    }

    function _plainLog() internal pure returns (IReactive.LogRecord memory log) {
        log.chain_id = 1301;
        log.tx_hash = uint256(keccak256("origin-tx"));
        log.log_index = 4;
    }

    // --- T149: lifecycle events and subscription reference counting -------------------------

    function test_pauseAndResumeEmitRulePausedWithTheTransition() public {
        uint256 ruleId = _addRule();

        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RulePaused(address(agent), ruleId, true);
        vm.prank(USER);
        agent.pauseRule(ruleId);

        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RulePaused(address(agent), ruleId, false);
        vm.prank(USER);
        agent.resumeRule(ruleId);
    }

    function test_cancelEmitsRuleCancelledAndReleasesTheTopic() public {
        uint256 ruleId = _addRule();
        assertEq(system.subscribeCount(), 1, "one clock");
        assertEq(system.unsubscribeCount(), 0);

        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RuleCancelled(address(agent), ruleId);
        vm.prank(USER);
        agent.cancelRule(ruleId);

        assertEq(system.unsubscribeCount(), 1);
        assertEq(agent.activeRuleCount(), 0);
    }

    function test_pausingTheLastRuleOnATopicUnsubscribesExactlyOnce() public {
        uint256 first = _addRule();
        uint256 second = _addRule();
        assertEq(system.subscribeCount(), 1, "one shared topic");

        vm.startPrank(USER);
        agent.pauseRule(first);
        assertEq(system.unsubscribeCount(), 0);
        agent.pauseRule(second);
        assertEq(system.unsubscribeCount(), 1, "the topic is released exactly once");
        vm.stopPrank();
    }

    function test_resumingReSubscribesOncePerTopic() public {
        uint256 first = _addRule();
        uint256 second = _addRule();

        vm.startPrank(USER);
        agent.pauseRule(first);
        agent.pauseRule(second);
        assertEq(system.unsubscribeCount(), 1);

        agent.resumeRule(first);
        assertEq(system.subscribeCount(), 2);
        agent.resumeRule(second);
        assertEq(system.subscribeCount(), 2, "one topic, one subscription");
        vm.stopPrank();
    }

    function test_cancellingAPausedRuleDoesNotReleaseTheTopicTwice() public {
        uint256 ruleId = _addRule();
        vm.startPrank(USER);
        agent.pauseRule(ruleId);
        assertEq(system.unsubscribeCount(), 1);
        agent.cancelRule(ruleId);
        assertEq(system.unsubscribeCount(), 1);
        vm.stopPrank();
    }

    // --- T150: reorder is owner-only, a full permutation, and drives evaluation order -------

    function test_reorderIsOwnerOnly() public {
        _addRule();
        uint256[] memory ids = new uint256[](1);
        ids[0] = 0;
        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        agent.reorderRules(ids);
    }

    function test_reorderRejectsDuplicateAndUnknownIds() public {
        _addRule();
        _addRule();

        uint256[] memory duplicate = new uint256[](2);
        duplicate[0] = 0;
        duplicate[1] = 0;
        vm.prank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        agent.reorderRules(duplicate);

        uint256[] memory unknown = new uint256[](2);
        unknown[0] = 0;
        unknown[1] = 7;
        vm.prank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        agent.reorderRules(unknown);
    }

    function test_reorderPersistsAndEvaluationHonoursTheNewOrder() public {
        uint256 first = _addAlert(1e18);
        uint256 second = _addAlert(1e18);
        uint256 third = _addAlert(1e18);

        uint256[] memory ids = new uint256[](3);
        ids[0] = third;
        ids[1] = first;
        ids[2] = second;
        vm.prank(USER);
        agent.reorderRules(ids);

        uint256[] memory stored = agent.getRuleIds();
        assertEq(stored[0], third);
        assertEq(stored[1], first);
        assertEq(stored[2], second);

        IReactive.LogRecord memory log = _plainLog();
        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RuleEvaluated(third, 1301, bytes32(uint256(keccak256("origin-tx"))), 4, false);
        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RuleEvaluated(first, 1301, bytes32(uint256(keccak256("origin-tx"))), 4, false);
        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RuleEvaluated(second, 1301, bytes32(uint256(keccak256("origin-tx"))), 4, false);
        vm.prank(address(system));
        agent.react(log);
    }

    // --- T151: the gas guard defers instead of breaching the ceiling or reverting -----------

    function test_reactDefersRulesWhenGasIsTightAndNeverReverts() public {
        for (uint256 i = 0; i < 5; ++i) {
            _addAlert(1e18);
        }

        vm.recordLogs();
        vm.prank(address(system));
        agent.react{gas: 110_000}(_plainLog());
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 deferred;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] == EVALUATION_DEFERRED_TOPIC) deferred += 1;
        }
        assertGt(deferred, 0, "at least one rule must be deferred under a tight gas budget");
    }

    function test_reactEvaluatesEveryRuleWhenGasIsPlentiful() public {
        for (uint256 i = 0; i < 5; ++i) {
            _addAlert(1e18);
        }

        vm.recordLogs();
        vm.prank(address(system));
        agent.react(_plainLog());
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 evaluated;
        uint256 deferred;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] == keccak256("RuleEvaluated(uint256,uint256,bytes32,uint32,bool)")) {
                evaluated += 1;
            }
            if (logs[i].topics[0] == EVALUATION_DEFERRED_TOPIC) deferred += 1;
        }
        assertEq(evaluated, 5);
        assertEq(deferred, 0);
    }

    // --- T152: per-run ceiling and per-user monthly cap have distinct errors ----------------

    function test_perRunCeilingRejectsBeforeTheMonthlyCap() public {
        uint256 ceiling = agent.MAX_SPEND_PER_RUN();
        RuleLib.Rule memory rule = _rule();
        rule.amountIn = ceiling + 1;

        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(ExceedsPerRunCap.selector, rule.amountIn, ceiling));
        agent.addRule(rule, false);
    }

    function test_monthlyCapRejectsTheAmountThatWouldExceedIt() public {
        uint256 cap = agent.MONTHLY_SPEND_CAP();
        RuleLib.Rule memory rule = _rule();
        rule.amountIn = agent.MAX_SPEND_PER_RUN();

        uint256 approved;
        while (approved + rule.amountIn <= cap) {
            _addRuleWithAmount(rule.amountIn);
            approved += rule.amountIn;
        }

        rule.amountIn = 1;
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(MonthlyCapExceeded.selector, approved + 1, cap));
        agent.addRule(rule, false);
    }

    function test_budgetLowIsEmittedWhenTheRemainingCapCrossesTheThreshold() public {
        uint256 cap = agent.MONTHLY_SPEND_CAP();
        uint256 threshold = agent.BUDGET_LOW_THRESHOLD();
        uint256 perRule = agent.MAX_SPEND_PER_RUN();

        uint256 approved;
        while (cap - (approved + perRule) > threshold) {
            _addRuleWithAmount(perRule);
            approved += perRule;
        }

        vm.recordLogs();
        _addRuleWithAmount(perRule);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 lowEvents;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] == BUDGET_LOW_TOPIC) lowEvents += 1;
        }
        assertGt(lowEvents, 0, "BudgetLow must fire before the account goes silent");
        assertLe(agent.remainingMonthlyBudget(), threshold);
    }

    function test_pausingReleasesMonthlyReservations() public {
        uint256 cap = agent.MONTHLY_SPEND_CAP();
        uint256 perRule = agent.MAX_SPEND_PER_RUN();

        uint256 approved;
        while (approved + perRule <= cap) {
            _addRuleWithAmount(perRule);
            approved += perRule;
        }

        uint256 first = agent.getRuleIds()[0];
        vm.prank(USER);
        agent.pauseRule(first);
        assertEq(agent.remainingMonthlyBudget(), cap - approved + perRule);
    }

    function test_pausedRuleCannotBeReorderedIntoEvaluation() public {
        uint256 ruleId = _addRule();
        vm.startPrank(USER);
        agent.pauseRule(ruleId);
        uint256[] memory ids = new uint256[](1);
        ids[0] = ruleId;
        agent.reorderRules(ids);
        vm.stopPrank();

        assertEq(agent.getRuleIds()[0], ruleId);
        assertEq(agent.activeRuleCount(), 0);
    }

    function test_gasGuardConstantDoesNotExceedTheProtocolCeiling() public view {
        assertLe(agent.MAX_REACT_GAS(), 900_000);
        assertLt(agent.REACT_GAS_RESERVE(), agent.MAX_REACT_GAS());
    }

    function test_reactRejectsNonSystemCallerEvenWithGasGuard() public {
        vm.expectRevert(NotServiceProvider.selector);
        agent.react{gas: 100_000}(_plainLog());
    }

    function test_cancelledRuleCannotBePausedAgain() public {
        uint256 ruleId = _addRule();
        vm.startPrank(USER);
        agent.cancelRule(ruleId);
        vm.expectRevert(abi.encodeWithSelector(RuleNotActive.selector, ruleId));
        agent.pauseRule(ruleId);
        vm.stopPrank();
    }

    function test_cancelledRulesDoNotConsumeTheLiveEvaluationBudget() public {
        for (uint256 i = 0; i < 40; ++i) {
            uint256 retired = _addRule();
            vm.prank(USER);
            agent.cancelRule(retired);
        }
        uint256 active = _addRule();
        IReactive.LogRecord memory log = _plainLog();
        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RuleEvaluated(active, log.chain_id, bytes32(log.tx_hash), uint32(log.log_index), false);
        vm.prank(address(system));
        agent.react{gas: 140_000}(log);
    }

    function test_reorderingLiveRulesPreservesPausedSlotsAndRejectsAStaleOrder() public {
        uint256 first = _addRule();
        uint256 paused = _addRule();
        uint256 second = _addRule();
        uint256 cancelled = _addRule();
        vm.startPrank(USER);
        agent.pauseRule(paused);
        agent.cancelRule(cancelled);
        uint256[] memory ids = agent.getEvaluationOrder();
        assertEq(ids.length, 2);
        bytes32 expected = keccak256(abi.encode(ids));
        ids[0] = second;
        ids[1] = cancelled;
        vm.expectRevert(InvalidTemplateParams.selector);
        agent.reorderEvaluationRules(ids, expected);
        ids[1] = second;
        vm.expectRevert(InvalidTemplateParams.selector);
        agent.reorderEvaluationRules(ids, expected);
        ids[1] = first;
        agent.reorderEvaluationRules(ids, expected);
        vm.expectRevert(InvalidTemplateParams.selector);
        agent.reorderEvaluationRules(ids, expected);
        agent.resumeRule(paused);
        vm.stopPrank();
        ids = agent.getEvaluationOrder();
        assertEq(ids.length, 3);
        assertEq(ids[0], second);
        assertEq(ids[1], paused);
        assertEq(ids[2], first);
    }

    function test_failedReplacementPreservesTheOriginalAndPausedReplacementStaysPaused() public {
        uint256 first = _addRule();
        uint256 paused = _addRule();
        uint256 last = _addRule();
        RuleLib.Rule memory replacement = _rule();
        replacement.amountIn = agent.MAX_SPEND_PER_RUN() + 1;
        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(RuleNotActive.selector, first));
        agent.replaceRule(first, 0, replacement, false);
        vm.expectPartialRevert(ExceedsPerRunCap.selector);
        agent.replaceRule(first, RuleLib.FLAG_ACTIVE, replacement, false);
        assertEq(agent.getEvaluationOrder()[0], first);
        assertEq(agent.monthlyReserved(), 30e6);
        agent.pauseRule(paused);
        replacement.amountIn = 5e6;
        uint256 next = agent.replaceRule(paused, 0, replacement, false);
        assertEq(agent.getRule(next).flags, 0);
        assertEq(agent.monthlyReserved(), 20e6);
        agent.resumeRule(next);
        vm.stopPrank();
        uint256[] memory order = agent.getEvaluationOrder();
        assertEq(order[0], first);
        assertEq(order[1], next);
        assertEq(order[2], last);
    }

    function _addRuleWithAmount(uint256 amount) internal returns (uint256 ruleId) {
        RuleLib.Rule memory rule = _rule();
        rule.amountIn = amount;
        vm.prank(USER);
        ruleId = agent.addRule(rule, false);
    }
}

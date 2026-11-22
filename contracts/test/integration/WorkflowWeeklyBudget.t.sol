// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {CallbackConfiguration} from "../../src/shared/ReactiveTypes.sol";
import {WorkflowAgentV2} from "../../src/workflow/v2/WorkflowAgentV2.sol";
import {WorkflowAgentFactoryV2} from "../../src/workflow/v2/WorkflowAgentFactoryV2.sol";
import {WorkflowProgramV2 as P} from "../../src/workflow/v2/WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "../../src/workflow/v2/WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "../../src/workflow/v2/WorkflowProtocolsV2.sol";
import {WorkflowVaultV2} from "../../src/workflow/v2/WorkflowVaultV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract WorkflowWeeklyBudgetTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant RECIPIENT = address(0xBEEF);
    address private constant PROXY = address(0xCA11);
    bytes32 private constant WORKFLOW = keccak256("weekly workflow");
    uint32 private constant LASNA = 5_318_007;
    uint256 private constant CRON = uint256(keccak256("Cron100(uint256)"));
    uint256 private constant BUDGET_SYNCED =
        uint256(keccak256("BudgetSynced(bytes32,uint96,uint96,uint128,uint128,uint64,uint32)"));
    uint64 private constant WEEK = 7 days;
    uint64 private constant WEEK_SKEW = 10 minutes;
    // 2026-11-16 00:00:00 UTC, a Monday.
    uint256 private constant MONDAY = 1_794_787_200;

    MockERC20 private usdc;
    MockERC20 private weth;
    MockPair private pair;
    MockRouter private router;
    MockSystemContract private system;
    WorkflowAgentV2 private agent;
    WorkflowVaultV2 private vault;
    bytes32 private programHash;

    struct BudgetView {
        uint96 usdcLimit;
        uint96 wethLimit;
        uint128 usdcSpent;
        uint128 wethSpent;
        uint128 usdcRemaining;
        uint128 wethRemaining;
        uint64 resetsAt;
        uint32 revision;
    }

    struct ExpectedBudget {
        uint96 usdcLimit;
        uint96 wethLimit;
        uint128 usdcSpent;
        uint128 wethSpent;
        uint128 usdcRemaining;
        uint32 revision;
    }

    function setUp() public {
        vm.warp(12 hours);
        _deployTokens();
        _deployAgent();
        _deployVault();
    }

    function _deployTokens() private {
        usdc = new MockERC20("USDC", "USDC", 6);
        weth = new MockERC20("WETH", "WETH", 18);
        pair = new MockPair(address(usdc), address(weth));
        router = new MockRouter();
        router.setPair(address(pair));
        usdc.mint(address(router), 100_000e6);
        weth.mint(address(router), 100 ether);
    }

    function _deployAgent() private {
        system = new MockSystemContract();
        WorkflowAgentFactoryV2 factory = new WorkflowAgentFactoryV2(system);
        vm.prank(OWNER);
        agent = WorkflowAgentV2(payable(factory.create()));
        vm.prank(OWNER);
        assertEq(factory.create(), address(agent));
    }

    function _deployVault() private {
        WorkflowProtocolsV2.Networks memory market;
        market.usdc = address(usdc);
        market.weth = address(weth);
        market.pair = address(pair);
        market.router = address(router);
        vault = new WorkflowVaultV2(
            PROXY,
            OWNER,
            address(agent),
            P.UNICHAIN_SEPOLIA,
            market,
            new WorkflowProgramValidatorV2()
        );
        vm.prank(OWNER);
        agent.linkVault(P.UNICHAIN_SEPOLIA, address(vault));
    }

    function testExactWeeklyLimitSettlesOnceAndPreservesUsageOnReplay() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 3e6);

        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.CONFIRMED());
        assertEq(_budget().usdcSpent, 1e6);
        assertEq(_budget().usdcRemaining, 0);

        P.Run memory replay = _run(101, P.SCHEDULE);
        assertEq(_deliver(replay), vault.CONFIRMED());
        assertEq(_budget().usdcSpent, 1e6);
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);

        vm.expectEmit(true, true, false, true, address(vault));
        emit WorkflowVaultV2.Outcome(
            WORKFLOW,
            _runId(_run(102, P.SCHEDULE)),
            1,
            vault.SKIPPED(),
            type(uint8).max,
            WorkflowVaultV2.WeeklyBudgetExceeded.selector
        );
        assertEq(_deliver(_run(102, P.SCHEDULE)), vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);
    }

    function testUsdcAndWethTotalsAreIndependent() public {
        P.Node[] memory nodes = new P.Node[](3);
        nodes[0] = _check(P.USDC_BELOW, 1.5e6, 0, 1, 2);
        nodes[1] = _leaf(_action(P.BUY, 1e6, address(0)));
        nodes[2] = _leaf(_action(P.SELL, 0.05 ether, address(0)));
        P.Program memory program = _program(P.SCHEDULE, nodes);
        program.usdcCap = 2e6;
        program.wethCap = 0.1 ether;
        _enable(program, 1e6, 0.1 ether);
        _price(2_000_000);
        usdc.mint(address(vault), 2e6);
        weth.mint(address(vault), 1 ether);

        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.CONFIRMED());
        assertEq(_deliver(_run(102, P.SCHEDULE)), vault.CONFIRMED());
        assertEq(_deliver(_run(103, P.SCHEDULE)), vault.SKIPPED());

        vm.prank(OWNER);
        vault.withdraw(address(usdc), 1e6);
        assertEq(_deliver(_run(104, P.SCHEDULE)), vault.CONFIRMED());
        assertEq(_deliver(_run(105, P.SCHEDULE)), vault.SKIPPED());

        BudgetView memory actual = _budget();
        assertEq(actual.usdcSpent, 1e6);
        assertEq(actual.wethSpent, 0.1 ether);
        assertEq(actual.usdcRemaining, 0);
        assertEq(actual.wethRemaining, 0);
        assertEq(router.swapCount(), 3);
    }

    function testPercentagePaymentUsesTheActualObservedAmount() public {
        P.Action memory send = P.Action(P.SEND, P.PERCENT, 5000, RECIPIENT);
        P.Program memory program = _program(P.PAYMENT, _path(send));
        program.usdcCap = 2e6;
        _enable(program, 1e6, 0);
        usdc.mint(address(vault), 2e6);

        assertEq(_deliver(_paymentRun(101, 2e6)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);
        assertEq(_deliver(_paymentRun(102, 2e6)), vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);
    }

    function testRefillCountsOnlyThePulledDeficit() public {
        _enable(
            _program(P.SCHEDULE, _branch(P.USDC_BELOW, 2e6, _action(P.REFILL, 1e6, address(0)))),
            0.2e6,
            0
        );
        usdc.mint(OWNER, 5e6);
        usdc.mint(address(vault), 1.8e6);
        vm.prank(OWNER);
        usdc.approve(address(vault), 5e6);

        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.CONFIRMED());
        assertEq(_budget().usdcSpent, 0.2e6);
        assertEq(_budget().usdcRemaining, 0);
        assertEq(usdc.balanceOf(address(vault)), 2e6);

        vm.prank(OWNER);
        vault.withdraw(address(usdc), 1.5e6);
        uint256 ownerBalance = usdc.balanceOf(OWNER);
        assertEq(_deliver(_run(102, P.SCHEDULE)), vault.SKIPPED());
        assertEq(usdc.balanceOf(OWNER), ownerBalance);
        assertEq(usdc.balanceOf(address(vault)), 0.5e6);
        assertEq(_budget().usdcSpent, 0.2e6);
    }

    function testLaterActionAboveTheBudgetRollsBackTheWholeRun() public {
        P.Node[] memory nodes = new P.Node[](1);
        nodes[0].actions = new P.Action[](2);
        nodes[0].actions[0] = _action(P.SEND, 0.6e6, RECIPIENT);
        nodes[0].actions[1] = _action(P.SEND, 0.6e6, OWNER);
        _enable(_program(P.SCHEDULE, nodes), 1e6, 0);
        usdc.mint(address(vault), 3e6);

        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), 0);
        assertEq(usdc.balanceOf(address(vault)), 3e6);
        assertEq(_budget().usdcSpent, 0);
    }

    function testARevertedRunLeavesUsageUnchanged() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 2e6, 0);
        usdc.mint(address(vault), 0.5e6);

        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.FAILED());
        assertEq(_budget().usdcSpent, 0);

        usdc.mint(address(vault), 1e6);
        assertEq(_deliver(_run(102, P.SCHEDULE)), vault.CONFIRMED());
        assertEq(_budget().usdcSpent, 1e6);
    }

    function testWeekResetsAtMondayMidnightAndReadsTheNewWeekEarly() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 6 days + 23 hours);
        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.CONFIRMED());

        vm.warp(MONDAY + 7 days - 1);
        assertEq(_budget().usdcSpent, 1e6);
        assertEq(_budget().usdcRemaining, 0);
        assertEq(_budget().resetsAt, MONDAY + 7 days);

        vm.warp(MONDAY + 7 days);
        assertEq(_budget().usdcSpent, 0);
        assertEq(_budget().usdcRemaining, 1e6);
        assertEq(_budget().resetsAt, MONDAY + 14 days);

        assertEq(_deliver(_run(102, P.SCHEDULE)), vault.CONFIRMED());
        assertEq(_budget().usdcSpent, 1e6);
        assertEq(_budget().usdcRemaining, 0);
    }

    function testCallbackOriginatingBeforeResetSettlesAgainstTheNewWeek() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 6 days + 22 hours);
        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.CONFIRMED());

        vm.warp(MONDAY + 6 days + 23 hours + 59 minutes);
        P.Run memory beforeReset = _run(102, P.SCHEDULE);
        beforeReset.expiresAt = uint64(MONDAY + 8 days);
        vm.warp(MONDAY + 7 days + 1 minutes);
        assertEq(_deliver(beforeReset), vault.CONFIRMED());
        assertEq(usdc.balanceOf(RECIPIENT), 2e6);
    }

    function testEditsPauseReauthorizationAndRestoringKeepUsage() public {
        P.Program memory program = _program(P.SCHEDULE, _path(_action(P.SEND, 0.6e6, RECIPIENT)));
        bytes memory encoded = abi.encode(program);
        _enable(program, 1e6, 0);
        usdc.mint(address(vault), 5e6);
        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.CONFIRMED());

        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 2e6, 0);
        _assertBudget(ExpectedBudget(2e6, 0, 0.6e6, 0, 1.4e6, 2));

        vm.startPrank(OWNER);
        vault.revoke(WORKFLOW, 1);
        vault.authorize(WORKFLOW, 2, encoded, "Weekly workflow");
        vm.stopPrank();
        _assertBudget(ExpectedBudget(2e6, 0, 0.6e6, 0, 1.4e6, 2));

        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 2, 2, 0, 0);
        _assertBudget(ExpectedBudget(0, 0, 0.6e6, 0, 0, 3));

        vm.startPrank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 2, 3, 2e6, 0);
        vault.checkIn(WORKFLOW);
        vm.stopPrank();
        _assertBudget(ExpectedBudget(2e6, 0, 0.6e6, 0, 1.4e6, 4));

        P.Run memory afterReauthorization = _run(102, P.SCHEDULE);
        afterReauthorization.epoch = 2;
        assertEq(_deliver(afterReauthorization), vault.CONFIRMED());
        assertEq(_budget().usdcSpent, 1.2e6);
        assertEq(_budget().usdcRemaining, 0.8e6);
    }

    function testStaleOrUnauthorizedBudgetEditsFail() public {
        P.Program memory program = _program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT)));
        bytes memory encoded = abi.encode(program);
        _enable(program, 1e6, 0);

        vm.prank(RECIPIENT);
        vm.expectRevert(WorkflowVaultV2.Unauthorized.selector);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 2e6, 0);

        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultV2.StaleBudget.selector);
        vault.setWeeklyBudget(WORKFLOW, 1, 0, 2e6, 0);

        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultV2.InvalidAuthorization.selector);
        vault.setWeeklyBudget(WORKFLOW, 0, 1, 2e6, 0);

        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 2e6, 0);
        vm.prank(OWNER);
        vault.authorize(WORKFLOW, 2, encoded, "Weekly workflow");
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultV2.InvalidAuthorization.selector);
        vault.setWeeklyBudget(WORKFLOW, 1, 2, 3e6, 0);
    }

    function testMultiActionRunFitsTheAgentCallbackGasLimit() public {
        P.Node[] memory nodes = new P.Node[](1);
        nodes[0].actions = new P.Action[](3);
        nodes[0].actions[0] = _action(P.SEND, 0.5e6, RECIPIENT);
        nodes[0].actions[1] = _action(P.BUY, 0.5e6, address(0));
        nodes[0].actions[2] = _action(P.SEND, 0.5e6, RECIPIENT);
        _enable(_program(P.SCHEDULE, nodes), 2e6, 0);
        _price(2_000_000);
        usdc.mint(address(vault), 3e6);
        P.Run memory run = _run(101, P.SCHEDULE);
        uint256 before = gasleft();
        vm.prank(PROXY);
        vault.execute(address(agent), WORKFLOW, run);
        uint256 used = before - gasleft();
        assertEq(vault.outcomes(_runId(run)), vault.CONFIRMED());
        assertLt(used, 850_000);
    }

    function testEveryOutcomePublishesTheWeeklyBudgetSnapshot() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 2e6);
        vm.warp(MONDAY + 1 hours);

        vm.recordLogs();
        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.CONFIRMED());
        _assertBudgetSnapshot(1e6);

        vm.recordLogs();
        assertEq(_deliver(_run(102, P.SCHEDULE)), vault.SKIPPED());
        _assertBudgetSnapshot(1e6);
    }

    function testExhaustedBudgetStopsCallbacksUntilTheWeekResets() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);

        _cron(1);
        assertEq(system.requestCount(), 1);
        vm.recordLogs();
        _deliverRequest(0);
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);
        _forwardBudget();

        vm.warp(MONDAY + 2 hours);
        _cron(2);
        assertEq(system.requestCount(), 1, "an over-budget run is never requested");

        vm.warp(MONDAY + WEEK + 1 hours);
        _cron(3);
        assertEq(system.requestCount(), 2, "the next week can dispatch again");
        _deliverRequest(1);
        assertEq(usdc.balanceOf(RECIPIENT), 2e6);
    }

    function testRaisedBudgetUnblocksTheNextTick() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);

        _cron(1);
        vm.recordLogs();
        _deliverRequest(0);
        _forwardBudget();

        vm.warp(MONDAY + 2 hours);
        _cron(2);
        assertEq(system.requestCount(), 1);

        vm.recordLogs();
        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 2e6, 0);
        _forwardBudget();

        _cron(3);
        assertEq(system.requestCount(), 2, "a raised limit resumes dispatch");
        _deliverRequest(1);
        assertEq(usdc.balanceOf(RECIPIENT), 2e6);
    }

    function testStaleBudgetSnapshotsCannotRewindTheMirror() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        vm.warp(MONDAY + 1 hours);

        _injectBudget(1e6, 1e6);
        _injectBudget(1e6, 0);
        _cron(1);
        assertEq(system.requestCount(), 0, "an older snapshot cannot unblock a dispatch");
    }

    function testWeekResetWaitsForTheChainClockSkew() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        _injectBudget(1e6, 1e6);

        vm.warp(MONDAY + WEEK - 1);
        _cron(1);
        assertEq(system.requestCount(), 0, "the last second of the week is still gated");

        vm.warp(MONDAY + WEEK + WEEK_SKEW - 1);
        _cron(2);
        assertEq(system.requestCount(), 0, "the boundary alone does not reset the mirror");

        vm.warp(MONDAY + WEEK + WEEK_SKEW);
        _cron(3);
        assertEq(system.requestCount(), 1, "the reset applies once both clocks must agree");
    }

    function testZeroCostPathsStillDispatchWhenTheBudgetIsSpent() public {
        P.Program memory program =
            _program(P.PRICE, _branch(P.PRICE_AT_LEAST, 2e18, _action(P.ALERT, 0, address(0))));
        _enable(program, 1e6, 0);
        _injectBudget(1e6, 1e6);

        IReactive.LogRecord memory log;
        log.chain_id = P.UNICHAIN_SEPOLIA;
        log._contract = ChainConfig.unichainSepolia().pair;
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        log.block_number = block.number + 1;
        log.tx_hash = 1;
        log.data = abi.encode(2e18 * 10_000, 10_000 ether);
        vm.prank(address(system));
        agent.react(log);
        assertEq(system.requestCount(), 1, "an alert is never gated by the weekly budget");
    }

    function _assertBudgetSnapshot(uint128 usdcSpent) private view {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 matches;
        for (uint256 index; index < logs.length; ++index) {
            if (
                logs[index].emitter != address(vault)
                    || logs[index].topics[0] != bytes32(BUDGET_SYNCED)
            ) continue;
            assertEq(logs[index].topics[1], WORKFLOW);
            (
                uint96 usdcLimit,
                uint96 wethLimit,
                uint128 spentUsdc,
                uint128 spentWeth,
                uint64 weekStart,
                uint32 revision
            ) = abi.decode(logs[index].data, (uint96, uint96, uint128, uint128, uint64, uint32));
            assertEq(usdcLimit, 1e6);
            assertEq(wethLimit, 0);
            assertEq(spentUsdc, usdcSpent);
            assertEq(spentWeth, 0);
            assertEq(weekStart, MONDAY);
            assertEq(revision, 1);
            matches += 1;
        }
        assertEq(matches, 1);
    }

    function _injectBudget(uint96 usdcLimit, uint128 usdcSpent) private {
        IReactive.LogRecord memory log;
        log.chain_id = P.UNICHAIN_SEPOLIA;
        log._contract = address(vault);
        log.topic_0 = BUDGET_SYNCED;
        log.topic_1 = uint256(WORKFLOW);
        log.data =
            abi.encode(usdcLimit, uint96(0), usdcSpent, uint128(0), uint64(MONDAY), uint32(1));
        vm.prank(address(system));
        agent.react(log);
    }

    function _forwardBudget() private {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 index; index < logs.length; ++index) {
            if (
                logs[index].emitter != address(vault)
                    || logs[index].topics[0] != bytes32(BUDGET_SYNCED)
            ) continue;
            IReactive.LogRecord memory log;
            log.chain_id = P.UNICHAIN_SEPOLIA;
            log._contract = address(vault);
            log.topic_0 = BUDGET_SYNCED;
            log.topic_1 = uint256(WORKFLOW);
            log.data = logs[index].data;
            log.block_number = block.number;
            log.tx_hash = index + 1;
            log.log_index = index;
            vm.prank(address(system));
            agent.react(log);
        }
    }

    function _cron(uint256 index) private {
        uint256 number = block.number + index;
        IReactive.LogRecord memory log;
        log.chain_id = LASNA;
        log._contract = ChainConfig.lasna().cronSource;
        log.topic_0 = CRON;
        log.topic_1 = number;
        log.block_number = number;
        log.tx_hash = number;
        vm.prank(address(system));
        agent.react(log);
    }

    function _deliverRequest(uint256 index) private {
        CallbackConfiguration memory request = system.requestAt(index);
        bytes memory payload = request.payload;
        address sender = address(agent);
        assembly ("memory-safe") {
            mstore(add(payload, 36), sender)
        }
        vm.prank(PROXY);
        (bool success,) = address(vault).call{gas: request.gasLimit}(payload);
        assertTrue(success);
    }

    function _budget() private view returns (BudgetView memory view_) {
        (
            view_.usdcLimit,
            view_.wethLimit,
            view_.usdcSpent,
            view_.wethSpent,
            view_.usdcRemaining,
            view_.wethRemaining,
            view_.resetsAt,
            view_.revision
        ) = vault.weeklyBudget(WORKFLOW);
    }

    function _assertBudget(ExpectedBudget memory expected) private view {
        BudgetView memory actual = _budget();
        assertEq(actual.usdcLimit, expected.usdcLimit);
        assertEq(actual.wethLimit, expected.wethLimit);
        assertEq(actual.usdcSpent, expected.usdcSpent);
        assertEq(actual.wethSpent, expected.wethSpent);
        assertEq(actual.usdcRemaining, expected.usdcRemaining);
        assertEq(actual.revision, expected.revision);
    }

    function _enable(P.Program memory program, uint96 usdcLimit, uint96 wethLimit) private {
        bytes memory encoded = abi.encode(program);
        programHash = keccak256(encoded);
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(
            WORKFLOW, 1, encoded, "Weekly workflow", usdcLimit, wethLimit
        );
        agent.enable(WORKFLOW, 1, encoded, "Weekly workflow", uint64(block.number));
        vm.stopPrank();
    }

    function _deliver(P.Run memory run) private returns (uint8) {
        vm.prank(PROXY);
        vault.execute(address(agent), WORKFLOW, run);
        return vault.outcomes(_runId(run));
    }

    function _runId(P.Run memory run) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(agent), WORKFLOW, run.originChain, run.originTransaction, run.originLogIndex
            )
        );
    }

    function _run(uint64 index, uint8 trigger) private view returns (P.Run memory run) {
        run.epoch = 1;
        run.programHash = programHash;
        run.originChain = trigger == P.SCHEDULE ? LASNA : P.UNICHAIN_SEPOLIA;
        run.originTransaction = bytes32(uint256(index));
        run.originBlock = uint64(block.number) + index;
        run.expiresAt = uint64(block.timestamp + 10 minutes);
        run.observationTime = uint64(block.timestamp);
    }

    function _paymentRun(uint64 index, uint256 observed) private view returns (P.Run memory run) {
        run = _run(index, P.PAYMENT);
        run.observed = observed;
    }

    function _price(uint112 quotePerWeth) private {
        pair.setReserves(quotePerWeth * 10_000, 10_000 ether);
    }

    function _program(uint8 trigger, P.Node[] memory nodes)
        private
        pure
        returns (P.Program memory program)
    {
        program.version = 2;
        program.chain = P.UNICHAIN_SEPOLIA;
        program.trigger = trigger;
        program.interval = trigger == P.SCHEDULE ? 1 hours : 0;
        program.usdcCap = 2e6;
        program.wethCap = 0.1 ether;
        program.slippage = 100;
        program.nodes = nodes;
    }

    function _action(uint8 kind, uint96 amount, address account)
        private
        pure
        returns (P.Action memory)
    {
        return P.Action(kind, P.FIXED, amount, account);
    }

    function _path(P.Action memory action) private pure returns (P.Node[] memory nodes) {
        nodes = new P.Node[](1);
        nodes[0] = _leaf(action);
    }

    function _branch(uint8 kind, uint128 value, P.Action memory action)
        private
        pure
        returns (P.Node[] memory nodes)
    {
        nodes = new P.Node[](3);
        nodes[0] = _check(kind, value, 0, 1, 2);
        nodes[1] = _leaf(action);
    }

    function _check(uint8 kind, uint128 value, uint128 upper, uint8 yes, uint8 no)
        private
        pure
        returns (P.Node memory)
    {
        return P.Node(kind, yes, no, value, upper, new P.Action[](0));
    }

    function _leaf(P.Action memory action) private pure returns (P.Node memory node) {
        node.actions = new P.Action[](1);
        node.actions[0] = action;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {CallbackConfiguration} from "../../src/shared/ReactiveTypes.sol";
import {WorkflowAgentV2} from "../../src/workflow/v2/WorkflowAgentV2.sol";
import {WorkflowAgentFactoryV2} from "../../src/workflow/v2/WorkflowAgentFactoryV2.sol";
import {WorkflowAgentReactV2} from "../../src/workflow/v2/WorkflowAgentReactV2.sol";
import {WorkflowAgentStorageV2} from "../../src/workflow/v2/WorkflowAgentStorageV2.sol";
import {WorkflowProgramV2 as P} from "../../src/workflow/v2/WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "../../src/workflow/v2/WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "../../src/workflow/v2/WorkflowProtocolsV2.sol";
import {WorkflowVaultV2} from "../../src/workflow/v2/WorkflowVaultV2.sol";
import {WorkflowVaultStorageV2} from "../../src/workflow/v2/WorkflowVaultStorageV2.sol";
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
        vm.chainId(ChainConfig.LASNA);
        WorkflowProgramValidatorV2 validator = new WorkflowProgramValidatorV2();
        WorkflowAgentReactV2 reactModule = new WorkflowAgentReactV2(system, validator);
        WorkflowAgentV2 impl = new WorkflowAgentV2(system, validator, address(reactModule));
        WorkflowAgentFactoryV2 factory =
            new WorkflowAgentFactoryV2(system, validator, address(impl));
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
        emit WorkflowVaultStorageV2.Outcome(
            WORKFLOW,
            _runId(_run(102, P.SCHEDULE)),
            1,
            vault.SKIPPED(),
            type(uint8).max,
            WorkflowVaultStorageV2.WeeklyBudgetExceeded.selector
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

    function testASkippedRunLeavesUsageUnchanged() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 2e6, 0);
        usdc.mint(address(vault), 0.5e6);

        assertEq(_deliver(_run(101, P.SCHEDULE)), vault.SKIPPED());
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
        vm.expectRevert(WorkflowVaultStorageV2.InvalidAuthorization.selector);
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
        vm.expectRevert(WorkflowVaultStorageV2.Unauthorized.selector);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 2e6, 0);

        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultStorageV2.StaleBudget.selector);
        vault.setWeeklyBudget(WORKFLOW, 1, 0, 2e6, 0);

        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultStorageV2.InvalidAuthorization.selector);
        vault.setWeeklyBudget(WORKFLOW, 0, 1, 2e6, 0);

        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 2e6, 0);
        vm.prank(OWNER);
        vault.authorize(WORKFLOW, 2, encoded, "Weekly workflow");
        vm.prank(OWNER);
        vm.expectRevert(WorkflowVaultStorageV2.InvalidAuthorization.selector);
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

    function testBudgetSyncedSkipsUnbudgetedClosedAndNonBudgetSkippedExpiredOrFailedOutcomes()
        public
    {
        // 1. Unbudgeted workflow emits zero BudgetSynced on authorizeWithWeeklyBudget(..., 0, 0)
        //    and zero BudgetSynced on CONFIRMED / SKIPPED / FAILED / EXPIRED.
        bytes32 unbudgeted = keccak256("unbudgeted");
        bytes memory schedEncoded =
            abi.encode(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))));
        vm.recordLogs();
        vm.prank(OWNER);
        vault.authorizeWithWeeklyBudget(unbudgeted, 1, schedEncoded, "Unbudgeted", 0, 0);
        assertEq(_countBudgetSynced(unbudgeted), 0, "zero limit staging emits no BudgetSynced");

        vm.recordLogs();
        P.Run memory insufficientRun = _run(101, P.SCHEDULE);
        insufficientRun.programHash = keccak256(schedEncoded);
        vm.prank(PROXY);
        vault.execute(address(agent), unbudgeted, insufficientRun);
        assertEq(vault.outcomes(_runIdFor(unbudgeted, insufficientRun)), vault.SKIPPED());
        assertEq(
            _countBudgetSynced(unbudgeted), 0, "InsufficientVaultBalance emits no BudgetSynced"
        );

        usdc.mint(address(vault), 5e6);
        vm.recordLogs();
        P.Run memory okRun = _run(102, P.SCHEDULE);
        okRun.programHash = keccak256(schedEncoded);
        vm.prank(PROXY);
        vault.execute(address(agent), unbudgeted, okRun);
        assertEq(vault.outcomes(_runIdFor(unbudgeted, okRun)), vault.CONFIRMED());
        assertEq(_countBudgetSynced(unbudgeted), 0, "unbudgeted CONFIRMED emits no BudgetSynced");

        // 2. Budgeted workflow skips BudgetSynced on non-budget SKIPPED, EXPIRED, FAILED, and Closed.
        bytes32 budgeted = keccak256("budgeted-selective");
        P.Program memory prog =
            _program(P.PRICE, _branch(P.PRICE_AT_LEAST, 2e18, _action(P.SEND, 1e6, RECIPIENT)));
        prog.once = true;
        bytes memory encoded = abi.encode(prog);
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(budgeted, 1, encoded, "Budgeted", 2e6, 0);
        agent.enable(budgeted, 1, encoded, "Budgeted", uint64(block.number));
        vm.stopPrank();
        _price(1_500_000);

        // Non-budget SKIPPED (empty condition leaf)
        vm.recordLogs();
        P.Run memory emptyLeaf = _run(103, P.PRICE);
        emptyLeaf.programHash = keccak256(encoded);
        emptyLeaf.observed = 1.5e18;
        vm.prank(PROXY);
        vault.execute(address(agent), budgeted, emptyLeaf);
        assertEq(vault.outcomes(_runIdFor(budgeted, emptyLeaf)), vault.SKIPPED());
        assertEq(_countBudgetSynced(budgeted), 0, "non-budget SKIPPED emits no BudgetSynced");

        // EXPIRED callback
        vm.recordLogs();
        P.Run memory expiredRun = _run(104, P.PRICE);
        expiredRun.programHash = keccak256(encoded);
        expiredRun.expiresAt = uint64(block.timestamp - 1);
        vm.prank(PROXY);
        vault.execute(address(agent), budgeted, expiredRun);
        assertEq(vault.outcomes(_runIdFor(budgeted, expiredRun)), vault.EXPIRED());
        assertEq(_countBudgetSynced(budgeted), 0, "EXPIRED emits no BudgetSynced");

        // FAILED callback (CapExceeded on budgeted PAYMENT workflow)
        bytes32 failWf = keccak256("budgeted-failed");
        P.Program memory failProg =
            _program(P.PAYMENT, _path(P.Action(P.SEND, P.PERCENT, 5_000, RECIPIENT)));
        failProg.usdcCap = 1e6;
        bytes memory failEncoded = abi.encode(failProg);
        vm.prank(OWNER);
        vault.authorizeWithWeeklyBudget(failWf, 1, failEncoded, "FailCheck", 2e6, 0);
        vm.recordLogs();
        P.Run memory failedRun = _run(105, P.PAYMENT);
        failedRun.programHash = keccak256(failEncoded);
        failedRun.observed = 3e6;
        vm.prank(PROXY);
        vault.execute(address(agent), failWf, failedRun);
        assertEq(vault.outcomes(_runIdFor(failWf, failedRun)), vault.FAILED());
        assertEq(_countBudgetSynced(failWf), 0, "FAILED emits no BudgetSynced");

        // once=true CONFIRMED -> Closed without redundant BudgetSynced
        _price(2_000_000);
        vm.recordLogs();
        P.Run memory closingRun = _run(106, P.PRICE);
        closingRun.programHash = keccak256(encoded);
        closingRun.observed = 2e18;
        vm.prank(PROXY);
        vault.execute(address(agent), budgeted, closingRun);
        assertEq(vault.outcomes(_runIdFor(budgeted, closingRun)), vault.CONFIRMED());
        assertEq(
            _countBudgetSynced(budgeted), 0, "once=true CONFIRMED emits Closed, not BudgetSynced"
        );

        // Clearing an existing limit via setWeeklyBudget(..., 0, 0) DOES emit BudgetSynced so Agent unpauses.
        vm.recordLogs();
        vm.prank(OWNER);
        vault.setWeeklyBudget(budgeted, 1, 1, 0, 0);
        assertEq(_countBudgetSynced(budgeted), 1, "clearing an active limit syncs the Agent");
    }

    function _runIdFor(bytes32 workflow, P.Run memory run) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(agent), workflow, run.originChain, run.originTransaction, run.originLogIndex
            )
        );
    }

    function _countBudgetSynced(bytes32 workflow) private view returns (uint256 matches) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 index; index < logs.length; ++index) {
            if (
                logs[index].emitter == address(vault)
                    && logs[index].topics[0] == bytes32(BUDGET_SYNCED)
                    && logs[index].topics[1] == workflow
            ) {
                matches += 1;
            }
        }
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
        assertTrue(agent.watchingPaused(WORKFLOW), "watching pauses with the budget");
        uint64 wake = agent.wakeBlock(WORKFLOW);
        assertGt(wake, 0, "a reset wake is pinned");
        assertEq(system.lastSubscribedTopic1(), wake, "the wake is pinned to one cron block");

        _cronAt(wake - 100);
        assertEq(system.requestCount(), 1, "an ordinary cron tick no longer charges the workflow");
        assertTrue(agent.watchingPaused(WORKFLOW));

        vm.warp(MONDAY + WEEK + 1 hours);
        vm.roll(wake);
        _cronAt(wake);
        assertEq(system.requestCount(), 1, "the wake itself does not dispatch");
        assertFalse(agent.watchingPaused(WORKFLOW), "the reset wake resumes watching");
        assertEq(agent.wakeBlock(WORKFLOW), 0, "the pin is cleared");

        _cronAt(wake + 100);
        assertEq(system.requestCount(), 2, "the next week can dispatch again");
        _deliverRequest(1);
        assertEq(usdc.balanceOf(RECIPIENT), 2e6);
    }

    function testPausedWorkflowIgnoresCronTicksUntilThePinnedWake() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);
        _injectBudget(1e6, 1e6);

        _cron(1);
        assertTrue(agent.watchingPaused(WORKFLOW));
        uint64 wake = agent.wakeBlock(WORKFLOW);
        uint256 subscriptions = system.subscribeCount();

        _cronAt(wake - 200);
        _cronAt(wake - 100);
        assertTrue(agent.watchingPaused(WORKFLOW), "ordinary ticks cannot resume watching");
        assertEq(system.requestCount(), 0);
        assertEq(system.subscribeCount(), subscriptions, "ordinary ticks re-subscribe nothing");
    }

    function testRaisedBudgetClearsTheResetWake() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);
        _cron(1);
        vm.recordLogs();
        _deliverRequest(0);
        _forwardBudget();

        vm.warp(MONDAY + 2 hours);
        _cron(2);
        assertTrue(agent.watchingPaused(WORKFLOW));
        assertGt(agent.wakeBlock(WORKFLOW), 0);

        vm.recordLogs();
        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 2e6, 0);
        _forwardBudget();

        assertFalse(agent.watchingPaused(WORKFLOW), "a raised limit restores watching");
        assertEq(agent.wakeBlock(WORKFLOW), 0, "the reset wake is removed");
        _cron(3);
        assertEq(system.requestCount(), 2, "the next tick dispatches again");
    }

    function testDisableWhilePausedRemovesTheWake() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        vm.warp(MONDAY + 1 hours);
        _injectBudget(1e6, 1e6);
        _cron(1);
        uint64 wake = agent.wakeBlock(WORKFLOW);
        assertTrue(agent.watchingPaused(WORKFLOW));

        vm.prank(OWNER);
        agent.disable(WORKFLOW, 1);
        assertFalse(agent.watchingPaused(WORKFLOW));
        assertEq(agent.wakeBlock(WORKFLOW), 0);

        _cronAt(wake);
        assertEq(system.requestCount(), 0, "a disabled workflow cannot wake");
    }

    function testPathAboveTheLimitPausesWithoutAResetWake() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 2e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 5e6);
        vm.warp(MONDAY + 1 hours);
        _injectBudget(1e6, 0);

        _cron(1);
        assertTrue(agent.watchingPaused(WORKFLOW));
        assertEq(agent.wakeBlock(WORKFLOW), 0, "a fresh week cannot admit this path");

        vm.recordLogs();
        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 3e6, 0);
        _forwardBudget();
        assertFalse(agent.watchingPaused(WORKFLOW), "a limit above the path resumes watching");

        _cron(2);
        assertEq(system.requestCount(), 1);
    }

    function testPermissionlessResumeRequiresHeadroomOrTheReset() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        vm.warp(MONDAY + 1 hours);
        _injectBudget(1e6, 1e6);
        _cron(1);
        assertTrue(agent.watchingPaused(WORKFLOW));

        vm.prank(RECIPIENT);
        vm.expectRevert(WorkflowAgentStorageV2.BudgetBlocked.selector);
        agent.resumeWatching(WORKFLOW);

        vm.warp(MONDAY + WEEK + WEEK_SKEW + 1);
        vm.prank(RECIPIENT);
        agent.resumeWatching(WORKFLOW);
        assertFalse(agent.watchingPaused(WORKFLOW));
        assertEq(agent.wakeBlock(WORKFLOW), 0);

        _cron(2);
        assertEq(system.requestCount(), 1, "a recovered workflow dispatches again");

        vm.prank(RECIPIENT);
        vm.expectRevert(WorkflowAgentStorageV2.NotPaused.selector);
        agent.resumeWatching(WORKFLOW);
    }

    function testPriceWorkflowPausesAndResumesWithTheBudget() public {
        _enable(_program(P.PRICE, _path(_action(P.BUY, 1e6, address(0)))), 1e6, 0);
        _price(2_000_000);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);

        _sync(1);
        vm.recordLogs();
        _deliverRequest(0);
        _forwardBudget();

        _sync(2);
        assertEq(system.requestCount(), 1, "an over-budget price run is not requested");
        assertTrue(agent.watchingPaused(WORKFLOW));
        assertGt(agent.wakeBlock(WORKFLOW), 0);

        vm.recordLogs();
        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 2e6, 0);
        _forwardBudget();
        assertFalse(agent.watchingPaused(WORKFLOW));

        _sync(3);
        assertEq(system.requestCount(), 2, "a funded price run resumes promptly");
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
        assertTrue(agent.watchingPaused(WORKFLOW));
        uint64 wake = agent.wakeBlock(WORKFLOW);
        assertGt(wake, 0);

        vm.warp(MONDAY + WEEK + WEEK_SKEW - 1);
        vm.roll(wake);
        _cronAt(wake);
        assertEq(system.requestCount(), 0, "the boundary alone does not reset the mirror");
        assertTrue(agent.watchingPaused(WORKFLOW), "an early wake only re-pins");
        uint64 next = agent.wakeBlock(WORKFLOW);
        assertGt(next, wake, "the pin moves toward the reset");

        vm.warp(MONDAY + WEEK + WEEK_SKEW);
        vm.roll(next);
        _cronAt(next);
        assertFalse(agent.watchingPaused(WORKFLOW), "the reset applies once both clocks must agree");
        _cronAt(next + 100);
        assertEq(system.requestCount(), 1);
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

    function testLongSchedulePausesImmediatelyUponBudgetExhaustion() public {
        P.Program memory program =
            _program(P.SCHEDULE, _branch(P.DIP_BY, 500, _action(P.SEND, 1e6, RECIPIENT)));
        program.interval = 4 days;
        _enable(program, 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);

        _price(2_000_000);
        _cron(1);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0);
        assertEq(usdc.balanceOf(RECIPIENT), 0, "first tick seeds reference baseline");

        vm.warp(MONDAY + 4 days + 2 hours);
        _price(1_800_000);
        uint256 unsubscribesBefore = system.unsubscribeCount();
        _cron(2);
        assertEq(system.requestCount(), 2);
        vm.recordLogs();
        _deliverRequest(1);
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);
        _forwardBudget();

        // Must pause immediately in _syncBudget without waiting 4 days for nextDue.
        assertTrue(agent.watchingPaused(WORKFLOW), "long schedule pauses right on sync");
        uint64 wake = agent.wakeBlock(WORKFLOW);
        assertGt(wake, 0, "pinned wake is scheduled for Monday reset");
        assertEq(system.unsubscribeCount(), unsubscribesBefore + 1, "cron removed");
        assertEq(system.lastSubscribedTopic1(), wake, "only the exact reset block is subscribed");
    }

    function testReenablingActiveExhaustedWorkflowEntersPausedImmediately() public {
        P.Program memory program = _program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT)));
        _enable(program, 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);

        _cron(1);
        vm.recordLogs();
        _deliverRequest(0);
        _forwardBudget();
        assertTrue(agent.watchingPaused(WORKFLOW));

        bytes memory encoded = abi.encode(program);
        uint256 subsBefore = system.subscribeCount();
        vm.startPrank(OWNER);
        vault.revoke(WORKFLOW, 1);
        vault.authorizeWithWeeklyBudget(WORKFLOW, 2, encoded, "Weekly workflow", 1e6, 0);
        agent.enable(WORKFLOW, 2, encoded, "Weekly workflow", uint64(block.number));
        vm.stopPrank();

        assertTrue(agent.watchingPaused(WORKFLOW), "re-enabled exhausted epoch starts paused");
        assertGt(agent.wakeBlock(WORKFLOW), 0);
        assertGt(system.subscribeCount(), subsBefore);
    }

    function testReenablingStoppedWorkflowAfterBudgetIncreaseClearsStaleMirror() public {
        P.Program memory program = _program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT)));
        _enable(program, 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);

        _cron(1);
        vm.recordLogs();
        _deliverRequest(0);
        _forwardBudget();
        assertTrue(agent.watchingPaused(WORKFLOW));

        vm.startPrank(OWNER);
        vault.revoke(WORKFLOW, 1);
        agent.disable(WORKFLOW, 1);
        bytes memory encoded = abi.encode(program);
        vault.authorizeWithWeeklyBudget(WORKFLOW, 2, encoded, "Weekly workflow", 2e6, 0);
        agent.enable(WORKFLOW, 2, encoded, "Weekly workflow", uint64(block.number));
        vm.stopPrank();

        assertFalse(agent.watchingPaused(WORKFLOW), "stale mirror from disabled epoch clears");
        assertEq(agent.wakeBlock(WORKFLOW), 0);
        _cron(2);
        assertEq(system.requestCount(), 2);
        _deliverRequest(1);
        assertEq(usdc.balanceOf(RECIPIENT), 2e6);
    }

    function testLoweringLimitBelowSpentUnpinsResetAndAllowsZeroCostAlert() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);

        _cron(1);
        vm.recordLogs();
        _deliverRequest(0);
        _forwardBudget();
        assertTrue(agent.watchingPaused(WORKFLOW));
        assertGt(agent.wakeBlock(WORKFLOW), 0);

        // Lowering limit below single-run cost (0.5 < 1) makes even fresh week impossible -> unpin.
        vm.recordLogs();
        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 1, 1, 0.5e6, 0);
        _forwardBudget();
        assertTrue(agent.watchingPaused(WORKFLOW));
        assertEq(agent.wakeBlock(WORKFLOW), 0, "unrecoverable limit removes wake pin");

        // Raising back to 1e6 is still blocked this week, but recoverable on reset -> re-pins.
        vm.recordLogs();
        vm.prank(OWNER);
        vault.setWeeklyBudget(WORKFLOW, 1, 2, 1e6, 0);
        _forwardBudget();
        assertTrue(agent.watchingPaused(WORKFLOW));
        assertGt(agent.wakeBlock(WORKFLOW), 0, "recoverable limit restores reset wake");

        // Zero-cost ALERT path must still run when spent > limit.
        bytes32 alertId = keccak256("alert when spent exceeds limit");
        P.Program memory alertProg =
            _program(P.PRICE, _branch(P.PRICE_AT_LEAST, 2e18, _action(P.ALERT, 0, address(0))));
        bytes memory encoded = abi.encode(alertProg);
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(alertId, 1, encoded, "Alert", 0.5e6, 0);
        agent.enable(alertId, 1, encoded, "Alert", uint64(block.number));
        vm.stopPrank();

        IReactive.LogRecord memory budgetLog;
        budgetLog.chain_id = P.UNICHAIN_SEPOLIA;
        budgetLog._contract = address(vault);
        budgetLog.topic_0 = BUDGET_SYNCED;
        budgetLog.topic_1 = uint256(alertId);
        budgetLog.data = abi.encode(
            uint96(0.5e6), uint96(0), uint128(1e6), uint128(0), uint64(MONDAY), uint32(1)
        );
        vm.prank(address(system));
        agent.react(budgetLog);
        assertFalse(agent.watchingPaused(alertId), "zero-cost path stays active when spent > limit");
        _sync(2);
        assertEq(system.requestCount(), 2, "alert still dispatches");
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

    function testCronPinningDoesNotChurnWhenScheduleActiveAndPaymentParked() public {
        bytes32 schedWf = keccak256("active schedule workflow");
        P.Program memory schedProg = _program(P.SCHEDULE, _path(_action(P.ALERT, 0, address(0))));
        schedProg.interval = 30 days;
        bytes memory schedEncoded = abi.encode(schedProg);
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(schedWf, 1, schedEncoded, "Active schedule", 0, 0);
        agent.enable(schedWf, 1, schedEncoded, "Active schedule", uint64(block.number));
        vm.stopPrank();

        P.Program memory payProg = _program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT)));
        payProg.usdcCap = 5e6;
        _enable(payProg, 1e6, 0);
        usdc.mint(address(vault), 5e6);
        vm.warp(MONDAY + 1 hours);

        // Exhaust weekly limit on the payment workflow, then park an incoming payment.
        vm.recordLogs();
        assertEq(_deliver(_paymentRun(101, 5e6)), vault.CONFIRMED());
        _forwardBudget();

        IReactive.LogRecord memory blockedPay;
        blockedPay.chain_id = P.UNICHAIN_SEPOLIA;
        blockedPay._contract = ChainConfig.unichainSepolia().usdc;
        blockedPay.topic_0 = uint256(keccak256("Transfer(address,address,uint256)"));
        blockedPay.topic_1 = uint160(RECIPIENT);
        blockedPay.topic_2 = uint160(address(vault));
        blockedPay.block_number = 102;
        blockedPay.tx_hash = 102;
        blockedPay.data = abi.encode(5e6);
        vm.prank(address(system));
        agent.react(blockedPay);
        assertEq(agent.pendingRuns(WORKFLOW), 1);

        uint64 initialWake = agent.wakeBlock(WORKFLOW);
        assertGt(initialWake, 0);
        uint256 subsBefore = system.subscribeCount();
        uint256 unsubsBefore = system.unsubscribeCount();

        // 20 intermediate Cron ticks while schedule keeps wildcard CRON active must NOT re-pin wake.
        for (uint256 i = 1; i <= 20; ++i) {
            vm.warp(block.timestamp + 2 seconds);
            _cron(i);
        }
        assertEq(agent.wakeBlock(WORKFLOW), initialWake);
        assertEq(system.subscribeCount(), subsBefore, "no churn subscribes on intermediate ticks");
        assertEq(
            system.unsubscribeCount(), unsubsBefore, "no churn unsubscribes on intermediate ticks"
        );
    }

    function testDustTransfersBlockedPreCallbackAndParkedPaymentsRetryFifo() public {
        address payer = address(0xBA11);
        P.Node[] memory n1 = new P.Node[](5);
        n1[0] = _check(P.PAYMENT_FROM, 0, 0, 1, 3);
        n1[1] = _check(P.AMOUNT_AT_LEAST, 5e6, 0, 2, 4);
        n1[2] = _leaf(P.Action(P.SEND, P.PERCENT, 1000, RECIPIENT));
        P.Program memory program = _program(P.PAYMENT, n1);
        program.subject = payer;
        program.usdcCap = 10e6;
        _enable(program, 5e6, 0);
        usdc.mint(address(vault), 20e6);
        vm.warp(MONDAY + 1 hours);

        // First two valid 25e6 payments spend 5e6 (10% each), exhausting the 5e6 weekly budget.
        vm.recordLogs();
        for (uint64 k = 200; k < 202; ++k) {
            P.Run memory firstRun = _paymentRun(k, 25e6);
            firstRun.actor = payer;
            assertEq(_deliver(firstRun), vault.CONFIRMED());
        }
        _forwardBudget();

        // 10 dust / wrong-sender transfers while budget is blocked: zero callbacks and zero parked runs.
        IReactive.LogRecord memory log;
        log.chain_id = P.UNICHAIN_SEPOLIA;
        log._contract = ChainConfig.unichainSepolia().usdc;
        log.topic_0 = uint256(keccak256("Transfer(address,address,uint256)"));
        log.topic_2 = uint160(address(vault));
        uint256 reqsBefore = system.requestCount();
        for (uint256 i = 1; i <= 10; ++i) {
            log.topic_1 = i <= 5 ? uint160(address(0xD057)) : uint160(payer);
            log.data = abi.encode(i <= 5 ? 10e6 : 4e6);
            log.block_number = 300 + i;
            log.tx_hash = 300 + i;
            vm.prank(address(system));
            agent.react(log);
        }
        assertEq(agent.pendingRuns(WORKFLOW), 0, "dust and unmatched transfers never fill pending");
        assertEq(system.requestCount(), reqsBefore);

        // 3 legitimate 6e6 / 7e6 / 8e6 payments park in pending FIFO order.
        log.topic_1 = uint160(payer);
        for (uint256 i = 1; i <= 3; ++i) {
            log.data = abi.encode((5 + i) * 1e6);
            log.block_number = 400 + i;
            log.tx_hash = 400 + i;
            vm.prank(address(system));
            agent.react(log);
        }
        assertEq(agent.pendingRuns(WORKFLOW), 3);

        // Warp past Monday reset + skew: _retryPending must flush one per tick in strict FIFO order (6e6, 7e6, 8e6).
        vm.warp(MONDAY + WEEK + WEEK_SKEW + 1);
        uint64 wake = agent.wakeBlock(WORKFLOW);
        _cronAt(wake);
        assertEq(agent.pendingRuns(WORKFLOW), 2);
        _cronAt(wake + 100);
        assertEq(agent.pendingRuns(WORKFLOW), 1);
        _cronAt(wake + 200);
        assertEq(agent.pendingRuns(WORKFLOW), 0);
        assertEq(system.requestCount(), reqsBefore + 3);
        for (uint256 i; i < 3; ++i) {
            CallbackConfiguration memory req = system.requestAt(reqsBefore + i);
            bytes memory argsData = new bytes(req.payload.length - 4);
            for (uint256 b; b < argsData.length; ++b) {
                argsData[b] = req.payload[b + 4];
            }
            (,, P.Run memory decoded) = abi.decode(argsData, (address, bytes32, P.Run));
            assertEq(decoded.observed, (6 + i) * 1e6, "parked payments must retry in FIFO order");
        }
    }

    function testEnableWithBudgetPreventsInitialRaceAndPostDisableAmnesia() public {
        bytes32 wf = keccak256("enable with budget race");
        P.Program memory prog = _program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT)));
        prog.usdcCap = 2e6;
        bytes memory encoded = abi.encode(prog);

        // Authorize with 0.5e6 limit -> 1e6 SEND exceeds limit immediately.
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(wf, 1, encoded, "Budgeted payment", 0.5e6, 0);
        agent.enableWithBudget(
            wf,
            1,
            encoded,
            "Budgeted payment",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(0.5e6, 0, 0, 0, uint64(MONDAY), 1)
        );
        vm.stopPrank();
        usdc.mint(address(vault), 5e6);

        IReactive.LogRecord memory payment;
        payment.chain_id = P.UNICHAIN_SEPOLIA;
        payment._contract = ChainConfig.unichainSepolia().usdc;
        payment.topic_0 = uint256(keccak256("Transfer(address,address,uint256)"));
        payment.topic_1 = uint160(RECIPIENT);
        payment.topic_2 = uint160(address(vault));
        payment.block_number = 500;
        payment.tx_hash = 500;
        payment.data = abi.encode(2e6);
        vm.prank(address(system));
        agent.react(payment);
        assertEq(system.requestCount(), 0, "initial over-budget payment parked instead of skipped");
        assertEq(agent.pendingRuns(wf), 1);

        // Disable then re-enable scheduled workflow with Vault's midweek spend (1e6 of 2e6):
        // enableWithBudget retains spent = 1e6 so a 1.5e6 path enters paused immediately.
        bytes32 schedWf = keccak256("post disable amnesia");
        P.Program memory spendProg = _program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT)));
        spendProg.usdcCap = 2e6;
        bytes memory spendEncoded = abi.encode(spendProg);
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(schedWf, 1, spendEncoded, "Midweek spend", 2e6, 0);
        agent.enableWithBudget(
            schedWf,
            1,
            spendEncoded,
            "Midweek spend",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(2e6, 0, 0, 0, uint64(MONDAY), 1)
        );
        vm.stopPrank();

        vm.warp(MONDAY + 1 hours);
        P.Run memory spendRun;
        spendRun.epoch = 1;
        spendRun.programHash = keccak256(spendEncoded);
        spendRun.originChain = LASNA;
        spendRun.originTransaction = bytes32(uint256(501));
        spendRun.originBlock = 501;
        spendRun.expiresAt = uint64(block.timestamp + 10 minutes);
        vm.prank(PROXY);
        vault.execute(address(agent), schedWf, spendRun);

        (uint96 uLim,, uint128 uSpent,,,, uint64 resetsAt, uint32 rev) = vault.weeklyBudget(schedWf);
        assertEq(uSpent, 1e6);

        P.Program memory biggerProg = _program(P.SCHEDULE, _path(_action(P.SEND, 1.5e6, RECIPIENT)));
        biggerProg.usdcCap = 2e6;
        bytes memory biggerEncoded = abi.encode(biggerProg);
        vm.startPrank(OWNER);
        agent.disable(schedWf, 1);
        vault.revoke(schedWf, 1);
        vault.authorizeWithWeeklyBudget(schedWf, 2, biggerEncoded, "Midweek spend v2", uLim, 0);
        agent.enableWithBudget(
            schedWf,
            2,
            biggerEncoded,
            "Midweek spend v2",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(
                uLim, 0, uSpent, 0, resetsAt >= WEEK ? resetsAt - WEEK : 0, rev
            )
        );
        vm.stopPrank();

        assertTrue(agent.watchingPaused(schedWf), "re-enabled workflow honors midweek spend");
    }

    function testResumeWatchingRePinsMissedWakeBlockBeforeReset() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))), 1e6, 0);
        usdc.mint(address(vault), 3e6);
        vm.warp(MONDAY + 1 hours);

        _cron(1);
        vm.recordLogs();
        _deliverRequest(0);
        _forwardBudget();
        uint64 wake1 = agent.wakeBlock(WORKFLOW);
        assertTrue(agent.watchingPaused(WORKFLOW));
        assertGt(wake1, 0);

        // Advance block.number past wake1 BEFORE Monday reset + skew: resumeWatching re-pins cleanly.
        vm.roll(wake1 + 50);
        agent.resumeWatching(WORKFLOW);
        uint64 wake2 = agent.wakeBlock(WORKFLOW);
        assertTrue(agent.watchingPaused(WORKFLOW));
        assertGt(wake2, wake1);

        // Before reaching wake2 and before reset, resumeWatching still reverts BudgetBlocked.
        vm.expectRevert(WorkflowAgentStorageV2.BudgetBlocked.selector);
        agent.resumeWatching(WORKFLOW);

        // Same re-pin behavior for parked-pending PAYMENT workflows.
        bytes32 payWf = keccak256("missed wake pending");
        P.Program memory payProg = _program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT)));
        payProg.usdcCap = 2e6;
        bytes memory payEncoded = abi.encode(payProg);
        vm.startPrank(OWNER);
        vault.authorizeWithWeeklyBudget(payWf, 1, payEncoded, "Pay missed", 1e6, 0);
        agent.enableWithBudget(
            payWf,
            1,
            payEncoded,
            "Pay missed",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(1e6, 0, 1e6, 0, uint64(MONDAY), 1)
        );
        vm.stopPrank();

        IReactive.LogRecord memory payment;
        payment.chain_id = P.UNICHAIN_SEPOLIA;
        payment._contract = ChainConfig.unichainSepolia().usdc;
        payment.topic_0 = uint256(keccak256("Transfer(address,address,uint256)"));
        payment.topic_1 = uint160(RECIPIENT);
        payment.topic_2 = uint160(address(vault));
        payment.block_number = block.number + 1;
        payment.tx_hash = 700;
        payment.data = abi.encode(2e6);
        vm.prank(address(system));
        agent.react(payment);
        uint64 payWake1 = agent.wakeBlock(payWf);
        assertGt(payWake1, 0);

        vm.roll(payWake1 + 25);
        agent.resumeWatching(payWf);
        assertGt(agent.wakeBlock(payWf), payWake1);
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
        _cronAt(block.number + index);
    }

    function _cronAt(uint256 number) private {
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

    function _sync(uint256 index) private {
        _syncPrice(index, 2_000_000);
    }

    function _syncPrice(uint256 index, uint112 quotePerWeth) private {
        IReactive.LogRecord memory log;
        log.chain_id = P.UNICHAIN_SEPOLIA;
        log._contract = ChainConfig.unichainSepolia().pair;
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        log.block_number = block.number + index;
        log.tx_hash = index;
        log.data = abi.encode(quotePerWeth * 10_000, 10_000 ether);
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
        program.originChain = P.UNICHAIN_SEPOLIA;
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

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {CallbackConfiguration} from "../../src/shared/ReactiveTypes.sol";
import {WorkflowAgentV2} from "../../src/workflow/v2/WorkflowAgentV2.sol";
import {WorkflowAgentFactoryV2} from "../../src/workflow/v2/WorkflowAgentFactoryV2.sol";
import {WorkflowProgramV2 as P} from "../../src/workflow/v2/WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "../../src/workflow/v2/WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "../../src/workflow/v2/WorkflowProtocolsV2.sol";
import {WorkflowVaultV2} from "../../src/workflow/v2/WorkflowVaultV2.sol";
import {WorkflowVaultFactoryV2} from "../../src/workflow/v2/WorkflowVaultFactoryV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract WorkflowV2Test is Test {
    WorkflowProgramValidatorV2 private validator = new WorkflowProgramValidatorV2();

    function testScheduleAcceptsBalanceBranch() public view {
        validator.validateProgram(abi.encode(_scheduledTopUp()));
    }

    function testRejectsDisconnectedAndDuplicateBranchNodes() public {
        P.Program memory program = _scheduledTopUp();
        program.nodes[0].no = 1;
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(program));
    }

    function testRejectsTransferAboveSignedAssetCap() public {
        P.Program memory program = _scheduledTopUp();
        program.usdcCap = 999_999;
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(program));
    }

    function testRejectsPaymentPercentageOnSchedule() public {
        P.Program memory program = _scheduledTopUp();
        program.nodes[1].actions[0].unit = P.PERCENT;
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(program));
    }

    function testRejectsARefillOnTheWrongBranch() public {
        P.Program memory program = _scheduledTopUp();
        program.nodes[2].actions = program.nodes[1].actions;
        program.nodes[1].actions = new P.Action[](0);
        vm.expectRevert(P.InvalidProgram.selector);
        validator.validateProgram(abi.encode(program));
    }

    function _scheduledTopUp() private pure returns (P.Program memory program) {
        P.Node[] memory nodes = new P.Node[](3);
        nodes[0].check = P.USDC_BELOW;
        nodes[0].value = 2e6;
        nodes[0].yes = 1;
        nodes[0].no = 2;
        nodes[1].actions = new P.Action[](1);
        nodes[1].actions[0] = P.Action(P.REFILL, P.FIXED, 1e6, address(0));
        program = P.Program({
            version: 2,
            chain: P.UNICHAIN_SEPOLIA,
            trigger: P.SCHEDULE,
            interval: 1 hours,
            expires: 0,
            source: address(0),
            subject: address(0),
            usdcCap: 1e6,
            wethCap: 0,
            slippage: 0,
            once: false,
            nodes: nodes
        });
    }
}

contract WorkflowV2SettlementTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant RECIPIENT = address(0xBEEF);
    address private constant PROXY = address(0xCA11);
    bytes32 private constant WORKFLOW = keccak256("workflow");
    uint32 private constant LASNA = 5_318_007;
    uint256 private constant CRON = uint256(keccak256("Cron100(uint256)"));
    uint256 private constant BUDGET_SYNCED =
        uint256(keccak256("BudgetSynced(bytes32,uint96,uint96,uint128,uint128,uint64,uint32)"));

    MockERC20 private usdc;
    MockERC20 private weth;
    MockPair private pair;
    MockRouter private router;
    MockSystemContract private system;
    WorkflowAgentV2 private agent;
    WorkflowVaultV2 private vault;
    bytes32 private programHash;

    function setUp() public {
        vm.warp(12 hours);
        usdc = new MockERC20("USDC", "USDC", 6);
        weth = new MockERC20("WETH", "WETH", 18);
        pair = new MockPair(address(usdc), address(weth));
        router = new MockRouter();
        router.setPair(address(pair));
        usdc.mint(address(router), 100_000e6);
        weth.mint(address(router), 100 ether);
        system = new MockSystemContract();
        WorkflowAgentFactoryV2 factory = new WorkflowAgentFactoryV2(system);
        vm.prank(OWNER);
        agent = WorkflowAgentV2(payable(factory.create()));
        vm.prank(OWNER);
        assertEq(factory.create(), address(agent));

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

    function testFactoryCreatesOneVaultPerOwnerAndRejectsAnAgentChange() public {
        vm.chainId(P.UNICHAIN_SEPOLIA);
        vm.etch(ChainConfig.unichainSepolia().callbackProxy, hex"00");
        WorkflowVaultFactoryV2 factory = new WorkflowVaultFactoryV2();
        vm.startPrank(OWNER);
        address walletVault = factory.create(address(agent));
        assertEq(factory.create(address(agent)), walletVault);
        assertEq(WorkflowVaultV2(payable(walletVault)).owner(), OWNER);
        vm.expectRevert(WorkflowVaultFactoryV2.AgentMismatch.selector);
        factory.create(RECIPIENT);
        vm.stopPrank();
    }

    function testCronRoutesOnceAndSettlementIgnoresAReplay() public {
        P.Program memory program = _program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT)));
        usdc.mint(address(vault), 3e6);
        _enable(program);
        IReactive.LogRecord memory tick;
        tick.chain_id = LASNA;
        tick._contract = ChainConfig.lasna().cronSource;
        tick.topic_0 = CRON;
        tick.block_number = block.number + 1;
        tick.topic_1 = tick.block_number;
        tick.tx_hash = 101;
        vm.expectRevert(WorkflowAgentV2.Unauthorized.selector);
        agent.react(tick);
        vm.prank(address(system));
        agent.react(tick);
        assertEq(system.requestCount(), 1);
        CallbackConfiguration memory request = system.requestAt(0);
        assertEq(request.chainId, P.UNICHAIN_SEPOLIA);
        assertEq(request.recipient, address(vault));
        bytes memory payload = request.payload;
        address sender = address(agent);
        assembly ("memory-safe") {
            mstore(add(payload, 36), sender)
        }
        vm.prank(PROXY);
        (bool first,) = address(vault).call{gas: request.gasLimit}(payload);
        vm.prank(PROXY);
        (bool replay,) = address(vault).call{gas: request.gasLimit}(payload);
        assertTrue(first && replay);
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.prank(address(system));
        agent.react(tick);
        assertEq(system.requestCount(), 1);
    }

    function testExpiredWorkflowRetiresWithASignalInsteadOfDispatching() public {
        P.Program memory program = _program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT)));
        program.expires = uint64(block.timestamp + 1 hours);
        _enable(program);
        vm.warp(uint256(program.expires) + 1);
        uint256 number = block.number + 1;
        IReactive.LogRecord memory tick;
        tick.chain_id = LASNA;
        tick._contract = ChainConfig.lasna().cronSource;
        tick.topic_0 = CRON;
        tick.topic_1 = number;
        tick.block_number = number;
        tick.tx_hash = number;
        vm.expectEmit(true, false, false, true, address(agent));
        emit WorkflowAgentV2.Expired(WORKFLOW, 1);
        vm.prank(address(system));
        agent.react(tick);
        assertEq(system.requestCount(), 0, "an expired workflow never dispatches");
        (,,,, uint8 trigger,,,,,,,,,) = agent.entries(WORKFLOW);
        assertEq(trigger, 0, "the expired workflow is no longer active");

        vm.prank(address(system));
        agent.react(tick);
        assertEq(system.requestCount(), 0, "a retired workflow stays retired");
    }

    function testLimitBuyUsesLivePriceAndIncludesEquality() public {
        _enable(_program(P.PRICE, _branch(P.PRICE_AT_MOST, 2e18, _action(P.BUY, 1e6, address(0)))));
        usdc.mint(address(vault), 3e6);
        _price(2_100_000);
        assertEq(_deliver(_run(101, P.PRICE, 1.9e18)), vault.SKIPPED());
        _price(2_000_000);
        assertEq(_deliver(_run(102, P.PRICE, 2e18)), vault.CONFIRMED());
        assertGt(weth.balanceOf(address(vault)), 0);
    }

    function testScheduledBuySwapsOnlyOneTimeForTheSameTick() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.BUY, 1e6, address(0)))));
        _price(2_000_000);
        P.Run memory run = _run(101, P.SCHEDULE, 0);
        assertEq(_deliver(run), vault.FAILED());
        usdc.mint(address(vault), 2e6);
        assertEq(_deliver(run), vault.FAILED());
        run.originTransaction = bytes32(uint256(102));
        assertEq(_deliver(run), vault.CONFIRMED());
        assertEq(_deliver(run), vault.CONFIRMED());
        assertEq(router.swapCount(), 1);
    }

    function testTakeProfitSellsAtTheTargetAndCloses() public {
        P.Program memory program = _program(
            P.PRICE, _branch(P.PRICE_AT_LEAST, 2e18, _action(P.SELL, 0.1 ether, address(0)))
        );
        program.once = true;
        _enable(program);
        weth.mint(address(vault), 1 ether);
        _price(1_900_000);
        assertEq(_deliver(_run(101, P.PRICE, 1.9e18)), vault.SKIPPED());
        _price(2_000_000);
        assertEq(_deliver(_run(102, P.PRICE, 2e18)), vault.CONFIRMED());
        assertEq(_deliver(_run(102, P.PRICE, 2e18)), vault.CONFIRMED());
        assertEq(_deliver(_run(103, P.PRICE, 2e18)), vault.SKIPPED());
        assertEq(router.swapCount(), 1);
    }

    function testIncomeSweepChoosesLargeSmallAndSkipPaths() public {
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = _check(P.AMOUNT_AT_LEAST, 1e6, 0, 1, 2);
        nodes[1] = _leaf(_action(P.SEND, 0.2e6, RECIPIENT));
        nodes[2] = _check(P.AMOUNT_AT_LEAST, 0.25e6, 0, 3, 4);
        nodes[3] = _leaf(_action(P.SEND, 0.05e6, RECIPIENT));
        _enable(_program(P.PAYMENT, nodes));
        usdc.mint(address(vault), 2e6);
        assertEq(_deliver(_run(101, P.PAYMENT, 1.2e6)), vault.CONFIRMED());
        assertEq(_deliver(_run(102, P.PAYMENT, 0.6e6)), vault.CONFIRMED());
        assertEq(_deliver(_run(103, P.PAYMENT, 0.1e6)), vault.SKIPPED());
        assertEq(_deliver(_run(102, P.PAYMENT, 0.6e6)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(RECIPIENT), 0.25e6);
    }

    function testBudgetBlockedPaymentIsParkedAndRetriedWhenTheLimitRises() public {
        _enable(_program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT))));
        usdc.mint(address(vault), 2e6);
        IReactive.LogRecord memory payment = _paymentLog(101, 1e6);

        _syncBudget(1e6, 1e6, 1);
        vm.prank(address(system));
        agent.react(payment);
        vm.prank(address(system));
        agent.react(payment);
        assertEq(system.requestCount(), 0);
        assertEq(agent.pendingRuns(WORKFLOW), 1, "the blocked origin is parked once");
        assertEq(system.subscribeCount(), 3, "the waiting list holds the cron retry subscription");

        _syncBudget(3e6, 1e6, 2);
        assertEq(system.requestCount(), 1, "raising the limit retries the parked run");
        assertEq(agent.pendingRuns(WORKFLOW), 0);
        assertEq(system.unsubscribeCount(), 1, "an empty waiting list releases the cron");
        _deliverRequest(0);
        assertEq(vault.outcomes(_runId(payment.tx_hash)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);

        vm.prank(address(system));
        agent.react(payment);
        assertEq(system.requestCount(), 1, "a dispatched origin stays deduplicated");
    }

    function testParkedTransferIsRetriedWhenTheLimitRises() public {
        P.Program memory program =
            _program(P.TRANSFER, _branch(P.AMOUNT_ABOVE, 2e6, _action(P.SEND, 0.5e6, RECIPIENT)));
        program.source = address(usdc);
        _enable(program);
        usdc.mint(address(vault), 2e6);
        IReactive.LogRecord memory transfer = _paymentLog(101, 10e6);
        transfer._contract = address(usdc);

        _syncBudget(1e6, 1e6, 1);
        vm.prank(address(system));
        agent.react(transfer);
        assertEq(system.requestCount(), 0);
        assertEq(agent.pendingRuns(WORKFLOW), 1);

        _syncBudget(2e6, 1e6, 2);
        assertEq(system.requestCount(), 1);
        assertEq(agent.pendingRuns(WORKFLOW), 0);
        _deliverRequest(0);
        assertEq(vault.outcomes(_runId(transfer.tx_hash)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(RECIPIENT), 0.5e6);
    }

    function testParkedPaymentRetriesOnCronAfterTheWeekResets() public {
        _enable(_program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT))));
        usdc.mint(address(vault), 2e6);
        IReactive.LogRecord memory payment = _paymentLog(101, 1e6);

        _syncBudget(1e6, 1e6, 1);
        vm.prank(address(system));
        agent.react(payment);
        assertEq(system.requestCount(), 0);
        assertEq(agent.pendingRuns(WORKFLOW), 1);

        vm.warp(vm.getBlockTimestamp() + 7 days + 10 minutes);
        _cron(1);
        assertEq(system.requestCount(), 1, "a cron tick after the reset retries the run");
        assertEq(agent.pendingRuns(WORKFLOW), 0);
        _deliverRequest(0);
        assertEq(vault.outcomes(_runId(payment.tx_hash)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);
    }

    function testDisablingAWorkflowDropsItsParkedRuns() public {
        _enable(_program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT))));
        usdc.mint(address(vault), 2e6);
        IReactive.LogRecord memory payment = _paymentLog(101, 1e6);
        _syncBudget(1e6, 1e6, 1);
        vm.prank(address(system));
        agent.react(payment);
        assertEq(agent.pendingRuns(WORKFLOW), 1);

        vm.prank(OWNER);
        agent.disable(WORKFLOW, 1);
        assertEq(agent.pendingRuns(WORKFLOW), 0);

        vm.warp(vm.getBlockTimestamp() + 7 days + 10 minutes);
        _cron(1);
        assertEq(system.requestCount(), 0, "a disabled workflow is never retried");
    }

    function testWaitingListIsBoundedAndReportsDrops() public {
        _enable(_program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT))));
        usdc.mint(address(vault), 2e6);
        _syncBudget(1e6, 1e6, 1);

        for (uint256 index; index < 9; ++index) {
            IReactive.LogRecord memory payment = _paymentLog(101 + index, 1e6);
            vm.prank(address(system));
            agent.react(payment);
        }
        assertEq(agent.pendingRuns(WORKFLOW), 8, "the waiting list is bounded");
        assertEq(system.requestCount(), 0);
    }

    function testPriceAlertConfirmsOnceAtTheTarget() public {
        P.Program memory program =
            _program(P.PRICE, _branch(P.PRICE_AT_LEAST, 2e18, _action(P.ALERT, 0, address(0))));
        program.once = true;
        _enable(program);
        _price(1_900_000);
        assertEq(_deliver(_run(101, P.PRICE, 1.9e18)), vault.SKIPPED());
        _price(2_000_000);
        assertEq(_deliver(_run(102, P.PRICE, 2e18)), vault.CONFIRMED());
        assertEq(_deliver(_run(102, P.PRICE, 2e18)), vault.CONFIRMED());
        assertEq(_deliver(_run(103, P.PRICE, 2e18)), vault.SKIPPED());
        assertEq(router.swapCount(), 0);
    }

    function testPriceBelowExcludesEquality() public {
        _enable(_program(P.PRICE, _branch(P.PRICE_BELOW, 2e18, _action(P.ALERT, 0, address(0)))));
        _price(2_000_000);
        assertEq(_deliver(_run(101, P.PRICE, 2e18)), vault.SKIPPED());
        _price(1_999_999);
        assertEq(_deliver(_run(102, P.PRICE, 1.999999e18)), vault.CONFIRMED());
    }

    function testRisingCrossRequiresAPreviousObservationAndAStillEligiblePrice() public {
        _enable(
            _program(P.PRICE, _branch(P.PRICE_RISES_THROUGH, 2e18, _action(P.ALERT, 0, address(0))))
        );
        _price(2_000_000);
        assertEq(_deliver(_run(101, P.PRICE, 2e18)), vault.SKIPPED());
        P.Run memory crossing = _run(102, P.PRICE, 1.95e18);
        crossing.previous = 1.9e18;
        assertEq(_deliver(crossing), vault.SKIPPED());
        crossing = _run(103, P.PRICE, 2e18);
        crossing.previous = 1.9e18;
        _price(1_900_000);
        assertEq(_deliver(crossing), vault.SKIPPED());
        crossing = _run(104, P.PRICE, 2e18);
        crossing.previous = 1.9e18;
        _price(2_000_000);
        assertEq(_deliver(crossing), vault.CONFIRMED());
        crossing = _run(105, P.PRICE, 2.1e18);
        crossing.previous = 2e18;
        _price(2_100_000);
        assertEq(_deliver(crossing), vault.SKIPPED());
    }

    function testFallingCrossRequiresStrictlyBelowTargetAndAStillEligiblePrice() public {
        _enable(
            _program(P.PRICE, _branch(P.PRICE_FALLS_THROUGH, 2e18, _action(P.ALERT, 0, address(0))))
        );
        _price(1_900_000);
        P.Run memory crossing = _run(101, P.PRICE, 2e18);
        crossing.previous = 2.1e18;
        assertEq(_deliver(crossing), vault.SKIPPED());
        _price(2_000_000);
        crossing = _run(102, P.PRICE, 1.9e18);
        crossing.previous = 2e18;
        assertEq(_deliver(crossing), vault.SKIPPED());
        crossing = _run(103, P.PRICE, 1.9e18);
        crossing.previous = 2e18;
        _price(1_900_000);
        assertEq(_deliver(crossing), vault.CONFIRMED());
    }

    function testPaymentFromUsesTheLoggedSenderAndCapsPercentageOfPayment() public {
        P.Action memory send = P.Action(P.SEND, P.PERCENT, 2500, RECIPIENT);
        P.Program memory program = _program(P.PAYMENT, _branch(P.PAYMENT_FROM, 0, send));
        program.subject = OWNER;
        program.usdcCap = 1e6;
        _enable(program);
        usdc.mint(address(vault), 10e6);
        IReactive.LogRecord memory payment;
        payment.chain_id = P.UNICHAIN_SEPOLIA;
        payment._contract = ChainConfig.unichainSepolia().usdc;
        payment.topic_0 = uint256(keccak256("Transfer(address,address,uint256)"));
        payment.topic_1 = uint160(RECIPIENT);
        payment.topic_2 = uint160(address(vault));
        payment.block_number = 101;
        payment.tx_hash = 101;
        payment.data = abi.encode(3e6);
        vm.prank(address(system));
        agent.react(payment);
        _deliverRequest(0);
        assertEq(vault.outcomes(_runId(payment.tx_hash)), vault.SKIPPED());

        payment.topic_1 = uint160(OWNER);
        payment.block_number = 102;
        payment.tx_hash = 102;
        payment.data = abi.encode(8e6);
        vm.prank(address(system));
        agent.react(payment);
        _deliverRequest(1);
        assertEq(vault.outcomes(_runId(payment.tx_hash)), vault.FAILED());

        payment.block_number = 103;
        payment.tx_hash = 103;
        payment.data = abi.encode(3e6);
        vm.prank(address(system));
        agent.react(payment);
        _deliverRequest(2);
        assertEq(vault.outcomes(_runId(payment.tx_hash)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(RECIPIENT), 0.75e6);
    }

    function testDipSignalIsConsumedOnlyAfterOneTrade() public {
        _enable(_program(P.SCHEDULE, _branch(P.DIP_BY, 500, _action(P.BUY, 1e6, address(0)))));
        usdc.mint(address(vault), 3e6);
        _price(1_900_000);
        P.Run memory run = _run(101, P.SCHEDULE, 1.9e18);
        run.previous = 2e18;
        run.observationId = keccak256("dip");
        assertEq(_deliver(run), vault.CONFIRMED());
        run.originTransaction = bytes32(uint256(102));
        assertEq(_deliver(run), vault.SKIPPED());
        bytes32 original = run.observationId;
        P.Run memory rising = _run(106, P.SCHEDULE, 2.1e18);
        rising.previous = 2e18;
        rising.observationId = keccak256("rising price");
        assertEq(_deliver(rising), vault.SKIPPED());
        run.originTransaction = bytes32(uint256(103));
        run.observationId = keccak256("another dip");
        assertEq(_deliver(run), vault.CONFIRMED());
        run.originTransaction = bytes32(uint256(104));
        run.observationId = original;
        assertEq(_deliver(run), vault.SKIPPED());
        run.originTransaction = bytes32(uint256(105));
        run.observationId = keccak256("stale dip");
        vm.warp(vm.getBlockTimestamp() + 1 hours + 1);
        run.expiresAt = uint64(vm.getBlockTimestamp() + 10 minutes);
        assertEq(_deliver(run), vault.SKIPPED());
        assertEq(router.swapCount(), 2);
    }

    function testPriceBandReferenceChangesOnlyAfterFillsInBothDirections() public {
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = _check(P.ABOVE_REFERENCE, 1_000, 2e18, 1, 2);
        nodes[1] = _leaf(_action(P.SELL, 0.1 ether, address(0)));
        nodes[2] = _check(P.BELOW_REFERENCE, 1_000, 2e18, 3, 4);
        nodes[3] = _leaf(_action(P.BUY, 1e6, address(0)));
        _enable(_program(P.PRICE, nodes));
        usdc.mint(address(vault), 2e6);
        _price(2_300_000);
        assertEq(_deliver(_run(101, P.PRICE, 2.3e18)), vault.FAILED());
        weth.mint(address(vault), 1 ether);
        _price(2_250_000);
        assertEq(_deliver(_run(102, P.PRICE, 2.25e18)), vault.CONFIRMED());
        _price(2_100_000);
        assertEq(_deliver(_run(103, P.PRICE, 2.1e18)), vault.SKIPPED());
        _price(2_000_000);
        assertEq(_deliver(_run(104, P.PRICE, 2e18)), vault.CONFIRMED());
        assertEq(router.swapCount(), 2);
    }

    function testTrailingStopTracksSkippedHighAndClosesAfterFill() public {
        P.Program memory program =
            _program(P.PRICE, _branch(P.TRAILING, 2_000, _action(P.SELL, 0.1 ether, address(0))));
        program.once = true;
        _enable(program);
        weth.mint(address(vault), 1 ether);
        _price(2_000_000);
        assertEq(_deliver(_run(101, P.PRICE, 2e18)), vault.SKIPPED());
        _price(1_700_000);
        assertEq(_deliver(_run(102, P.PRICE, 1.7e18)), vault.SKIPPED());
        _price(1_500_000);
        assertEq(_deliver(_run(103, P.PRICE, 1.5e18)), vault.CONFIRMED());
        assertEq(_deliver(_run(104, P.PRICE, 1.5e18)), vault.SKIPPED());
        assertEq(router.swapCount(), 1);
        IReactive.LogRecord memory closed;
        closed.chain_id = P.UNICHAIN_SEPOLIA;
        closed._contract = address(vault);
        closed.topic_0 = uint256(keccak256("Closed(bytes32,uint64)"));
        closed.topic_1 = uint256(WORKFLOW);
        closed.topic_2 = 1;
        vm.prank(address(system));
        agent.react(closed);
        assertEq(system.unsubscribeCount(), 3);
    }

    function testCompetingExitBranchesSettleOnlyOnce() public {
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = _check(P.PRICE_AT_LEAST, 3e18, 0, 1, 2);
        nodes[1] = _leaf(_action(P.SELL, 0.1 ether, address(0)));
        nodes[2] = _check(P.PRICE_BELOW, 2e18, 0, 3, 4);
        nodes[3] = _leaf(_action(P.SELL, 0.1 ether, address(0)));
        P.Program memory program = _program(P.PRICE, nodes);
        program.once = true;
        _enable(program);
        weth.mint(address(vault), 1 ether);
        P.Run memory takeProfit = _run(101, P.PRICE, 3e18);
        P.Run memory stopLoss = _run(102, P.PRICE, 1.5e18);
        _price(1_500_000);
        assertEq(_deliver(stopLoss), vault.CONFIRMED());
        _price(3_000_000);
        assertEq(_deliver(takeProfit), vault.SKIPPED());
        assertEq(router.swapCount(), 1);
    }

    function testTrailingStopKeepsOriginHighWhenCallbacksArriveOutOfOrder() public {
        _enable(
            _program(P.PRICE, _branch(P.TRAILING, 2_000, _action(P.SELL, 0.1 ether, address(0))))
        );
        weth.mint(address(vault), 1 ether);
        _price(1_000_000);
        _sync(101, 1_000_000);
        _deliverRequest(0);
        _sync(102, 2_000_000);
        _sync(103, 1_500_000);
        _price(1_500_000);
        _deliverRequest(2);
        _deliverRequest(1);
        assertEq(router.swapCount(), 1);
    }

    function testTrailingStopIgnoresHighsBeforeTheDestinationAuthorization() public {
        vm.roll(50);
        _enable(
            _program(P.PRICE, _branch(P.TRAILING, 2_000, _action(P.SELL, 0.1 ether, address(0))))
        );
        weth.mint(address(vault), 1 ether);
        _sync(40, 2_500_000);
        assertEq(system.requestCount(), 0);
        _sync(51, 1_500_000);
        _price(1_500_000);
        _deliverRequest(0);
        assertEq(router.swapCount(), 0);
    }

    function testStagedAuthorizationIsDiscoverableAndRevocableWithoutAnAgentEntry() public {
        bytes memory encoded =
            abi.encode(_program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT))));
        vm.startPrank(OWNER);
        vault.authorize(WORKFLOW, 1, encoded, "Staged transfer");
        assertEq(vault.workflowIds()[0], WORKFLOW);
        assertEq(vault.titles(WORKFLOW), "Staged transfer");
        assertEq(agent.workflowIds().length, 0);
        vault.revoke(WORKFLOW, 1);
        vm.stopPrank();
        assertEq(vault.paymentWorkflow(), bytes32(0));
    }

    function testPriceRangeAlertsOnlyOutsideInclusiveEdges() public {
        P.Node[] memory nodes = _branch(P.PRICE_OUTSIDE, 1e18, _action(P.ALERT, 0, address(0)));
        nodes[0].upper = 3e18;
        P.Program memory program = _program(P.PRICE, nodes);
        program.once = true;
        _enable(program);
        _price(3_000_000);
        assertEq(_deliver(_run(101, P.PRICE, 3e18)), vault.SKIPPED());
        _price(3_100_000);
        assertEq(_deliver(_run(102, P.PRICE, 3.1e18)), vault.CONFIRMED());
        assertEq(_deliver(_run(102, P.PRICE, 3.1e18)), vault.CONFIRMED());
        assertEq(_deliver(_run(103, P.PRICE, 3.1e18)), vault.SKIPPED());
    }

    function testLargeTransferOnlyWatchesIncomingVaultTransfersAboveThreshold() public {
        P.Program memory program =
            _program(P.TRANSFER, _branch(P.AMOUNT_ABOVE, 2e6, _action(P.ALERT, 0, address(0))));
        program.source = address(usdc);
        program.once = true;
        _enable(program);
        IReactive.LogRecord memory transfer;
        transfer.chain_id = P.UNICHAIN_SEPOLIA;
        transfer._contract = address(usdc);
        transfer.topic_0 = uint256(keccak256("Transfer(address,address,uint256)"));
        transfer.topic_1 = uint160(RECIPIENT);
        transfer.topic_2 = uint160(OWNER);
        transfer.block_number = 101;
        transfer.tx_hash = 101;
        transfer.data = abi.encode(10e6);
        vm.prank(address(system));
        agent.react(transfer);
        assertEq(system.requestCount(), 0);
        transfer.topic_2 = uint160(address(vault));
        transfer.data = abi.encode(2e6);
        transfer.tx_hash = 102;
        vm.prank(address(system));
        agent.react(transfer);
        _deliverRequest(0);
        assertEq(vault.outcomes(_runId(transfer.tx_hash)), vault.SKIPPED());
        transfer.data = abi.encode(type(uint256).max);
        transfer.tx_hash = 103;
        vm.prank(address(system));
        agent.react(transfer);
        _deliverRequest(1);
        assertEq(vault.outcomes(_runId(transfer.tx_hash)), vault.CONFIRMED());
        vm.prank(address(system));
        agent.react(transfer);
        assertEq(system.requestCount(), 2);
    }

    function testRefillPullsOnlyTheDeficitAndRespectsAllowance() public {
        _enable(
            _program(P.SCHEDULE, _branch(P.USDC_BELOW, 2e6, _action(P.REFILL, 1e6, address(0))))
        );
        usdc.mint(OWNER, 5e6);
        usdc.mint(address(vault), 1.8e6);
        assertEq(_deliver(_run(101, P.SCHEDULE, 0)), vault.FAILED());
        vm.prank(OWNER);
        usdc.approve(address(vault), 1e6);
        assertEq(_deliver(_run(102, P.SCHEDULE, 0)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(address(vault)), 2e6);
        assertEq(usdc.balanceOf(OWNER), 4.8e6);
        assertEq(_deliver(_run(103, P.SCHEDULE, 0)), vault.SKIPPED());
    }

    function testInactivityPayoutWaitsForGraceAndOwnerCheckInCancelsIt() public {
        P.Program memory program = _program(
            P.SCHEDULE, _branch(P.INACTIVITY, 1 days, _action(P.INACTIVITY_PAYOUT, 1e6, RECIPIENT))
        );
        program.once = true;
        _enable(program);
        usdc.mint(address(vault), 2e6);
        uint256 authorized = vm.getBlockTimestamp();
        assertEq(_deliver(_run(101, P.SCHEDULE, 0)), vault.SKIPPED());
        vm.warp(authorized + 1 days);
        assertEq(_deliver(_run(102, P.SCHEDULE, 0)), vault.IN_GRACE_PERIOD());
        vm.warp(vm.getBlockTimestamp() + 23 hours);
        vm.prank(OWNER);
        vault.checkIn(WORKFLOW);
        vm.warp(authorized + 2 days);
        assertEq(_deliver(_run(103, P.SCHEDULE, 0)), vault.SKIPPED());
        vm.warp(authorized + 3 days);
        assertEq(_deliver(_run(104, P.SCHEDULE, 0)), vault.IN_GRACE_PERIOD());
        vm.warp(vm.getBlockTimestamp() + 24 hours);
        assertEq(_deliver(_run(105, P.SCHEDULE, 0)), vault.CONFIRMED());
        assertEq(_deliver(_run(106, P.SCHEDULE, 0)), vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);
    }

    function testWrongCallersExpiredAndRevokedEpochCannotSend() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))));
        usdc.mint(address(vault), 3e6);
        P.Run memory run = _run(101, P.SCHEDULE, 0);
        vm.expectRevert(WorkflowVaultV2.Unauthorized.selector);
        vault.execute(address(agent), WORKFLOW, run);
        vm.prank(PROXY);
        vm.expectRevert(WorkflowVaultV2.Unauthorized.selector);
        vault.execute(OWNER, WORKFLOW, run);
        run.expiresAt = uint64(vm.getBlockTimestamp() - 1);
        assertEq(_deliver(run), vault.EXPIRED());
        vm.prank(OWNER);
        vault.revoke(WORKFLOW, 1);
        assertEq(_deliver(_run(102, P.SCHEDULE, 0)), vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), 0);
    }

    function testPaymentCannotSpendMoreThanTheOriginAndEarlierStepsRollBack() public {
        P.Node[] memory nodes = new P.Node[](1);
        nodes[0].actions = new P.Action[](2);
        nodes[0].actions[0] = _action(P.SEND, 1e6, RECIPIENT);
        nodes[0].actions[1] = _action(P.SEND, 1e6, OWNER);
        _enable(_program(P.PAYMENT, nodes));
        usdc.mint(address(vault), 4e6);
        assertEq(_deliver(_run(101, P.PAYMENT, 1.5e6)), vault.FAILED());
        assertEq(usdc.balanceOf(RECIPIENT), 0);
        assertEq(usdc.balanceOf(address(vault)), 4e6);
    }

    function _enable(P.Program memory program) private {
        bytes memory encoded = abi.encode(program);
        programHash = keccak256(encoded);
        vm.startPrank(OWNER);
        vault.authorize(WORKFLOW, 1, encoded, "Workflow V2");
        agent.enable(WORKFLOW, 1, encoded, "Workflow V2", uint64(block.number));
        vm.stopPrank();
    }

    function _deliver(P.Run memory run) private returns (uint8) {
        vm.prank(PROXY);
        vault.execute(address(agent), WORKFLOW, run);
        bytes32 id = keccak256(
            abi.encode(
                address(agent), WORKFLOW, run.originChain, run.originTransaction, run.originLogIndex
            )
        );
        return vault.outcomes(id);
    }

    function _runId(uint256 transaction) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(agent), WORKFLOW, P.UNICHAIN_SEPOLIA, bytes32(transaction), uint64(0)
            )
        );
    }

    function _paymentLog(uint256 transaction, uint256 amount)
        private
        view
        returns (IReactive.LogRecord memory payment)
    {
        payment.chain_id = P.UNICHAIN_SEPOLIA;
        payment._contract = ChainConfig.unichainSepolia().usdc;
        payment.topic_0 = uint256(keccak256("Transfer(address,address,uint256)"));
        payment.topic_1 = uint160(RECIPIENT);
        payment.topic_2 = uint160(address(vault));
        payment.block_number = transaction;
        payment.tx_hash = transaction;
        payment.data = abi.encode(amount);
    }

    function _cron(uint256 offset) private {
        uint256 number = block.number + offset;
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

    function _syncBudget(uint96 usdcLimit, uint128 usdcSpent, uint32 revision) private {
        IReactive.LogRecord memory log;
        log.chain_id = P.UNICHAIN_SEPOLIA;
        log._contract = address(vault);
        log.topic_0 = BUDGET_SYNCED;
        log.topic_1 = uint256(WORKFLOW);
        log.block_number = block.number;
        log.tx_hash = uint256(keccak256(abi.encode("budget", revision)));
        log.data = abi.encode(
            usdcLimit, uint96(0), usdcSpent, uint128(0), uint64(block.timestamp), revision
        );
        vm.prank(address(system));
        agent.react(log);
    }

    function _sync(uint64 origin, uint112 quotePerWeth) private {
        IReactive.LogRecord memory log;
        log.chain_id = P.UNICHAIN_SEPOLIA;
        log._contract = ChainConfig.unichainSepolia().pair;
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        log.block_number = origin;
        log.tx_hash = origin;
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

    function _price(uint112 quotePerWeth) private {
        pair.setReserves(quotePerWeth * 10_000, 10_000 ether);
    }

    function _run(uint64 index, uint8 trigger, uint128 observed)
        private
        view
        returns (P.Run memory run)
    {
        run.epoch = 1;
        run.programHash = programHash;
        run.originChain = trigger == P.SCHEDULE ? LASNA : P.UNICHAIN_SEPOLIA;
        run.originTransaction = bytes32(uint256(index));
        run.originBlock = uint64(block.number) + index;
        run.expiresAt = uint64(vm.getBlockTimestamp() + 10 minutes);
        run.observationTime = uint64(vm.getBlockTimestamp());
        run.observed = observed;
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

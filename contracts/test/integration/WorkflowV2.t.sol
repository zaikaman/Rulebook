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
import {WorkflowVaultFactoryV2} from "../../src/workflow/v2/WorkflowVaultFactoryV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract WorkflowV2Test is Test {
    WorkflowProgramValidatorV2 private validator = new WorkflowProgramValidatorV2();

    function testScheduleAcceptsBalanceBranch() public view {
        validator.validateProgram(abi.encode(_scheduledTopUp()));

        P.Program memory payRefill = _scheduledTopUp();
        payRefill.trigger = P.PAYMENT;
        assertTrue(validator.canTriggerTransfer(abi.encode(payRefill), 100_000, address(0xBEEF)));
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
            originChain: P.UNICHAIN_SEPOLIA,
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
        vm.chainId(ChainConfig.LASNA);
        WorkflowProgramValidatorV2 agentValidator = new WorkflowProgramValidatorV2();
        WorkflowAgentReactV2 reactModule = new WorkflowAgentReactV2(system, agentValidator);
        WorkflowAgentV2 agentImpl =
            new WorkflowAgentV2(system, agentValidator, address(reactModule));
        WorkflowAgentFactoryV2 factory =
            new WorkflowAgentFactoryV2(system, agentValidator, address(agentImpl));
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
        ChainConfig.Config memory cfg = ChainConfig.unichainSepolia();
        vm.etch(cfg.callbackProxy, hex"00");
        WorkflowProgramValidatorV2 vaultValidator = new WorkflowProgramValidatorV2();
        WorkflowProtocolsV2.Networks memory market = WorkflowProtocolsV2.Networks(
            cfg.usdc,
            cfg.weth,
            cfg.router,
            cfg.pair,
            cfg.poolFee,
            cfg.ethUsdFeed,
            cfg.usdcUsdFeed,
            cfg.sequencerFeed,
            cfg.ethFeedMaxAge,
            cfg.usdcFeedMaxAge
        );
        WorkflowVaultV2 impl = new WorkflowVaultV2(
            cfg.callbackProxy, address(0), address(0), P.UNICHAIN_SEPOLIA, market, vaultValidator
        );
        WorkflowVaultFactoryV2 factory = new WorkflowVaultFactoryV2(vaultValidator, address(impl));
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
        vm.expectRevert(WorkflowAgentStorageV2.Unauthorized.selector);
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
        emit WorkflowAgentStorageV2.Expired(WORKFLOW, 1);
        vm.prank(address(system));
        agent.react(tick);
        assertEq(system.requestCount(), 0, "an expired workflow never dispatches");
        (,,,, uint8 trigger,,,,,,,,,,) = agent.entries(WORKFLOW);
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
        assertEq(_deliver(run), vault.SKIPPED(), "an unfunded swap is skipped, not failed");
        usdc.mint(address(vault), 2e6);
        assertEq(_deliver(run), vault.SKIPPED(), "the recorded outcome of the tick stands");
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
        uint64 wake = agent.wakeBlock(WORKFLOW);
        assertGt(wake, 0, "a recoverable parked run pins only the reset block");
        assertEq(system.subscribeCount(), 3);
        assertEq(system.lastSubscribedTopic1(), wake);

        _syncBudget(3e6, 1e6, 2);
        assertEq(system.requestCount(), 1, "raising the limit retries the parked run");
        assertEq(agent.pendingRuns(WORKFLOW), 0);
        assertEq(agent.wakeBlock(WORKFLOW), 0);
        assertEq(system.unsubscribeCount(), 1, "an empty waiting list releases the wake pin");
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

    function testPermissionlessResumeRetriesParkedPaymentIfWakeMissed() public {
        _enable(_program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT))));
        usdc.mint(address(vault), 2e6);
        IReactive.LogRecord memory payment = _paymentLog(101, 1e6);

        _syncBudget(1e6, 1e6, 1);
        vm.prank(address(system));
        agent.react(payment);

        vm.expectRevert(WorkflowAgentStorageV2.BudgetBlocked.selector);
        agent.resumeWatching(WORKFLOW);

        vm.warp(vm.getBlockTimestamp() + 7 days + 10 minutes);
        vm.prank(RECIPIENT);
        agent.resumeWatching(WORKFLOW);
        assertEq(
            system.requestCount(), 1, "missed reset wake can still be recovered permissionlessly"
        );
        assertEq(agent.pendingRuns(WORKFLOW), 0);
        assertEq(agent.wakeBlock(WORKFLOW), 0);
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

    function testParkedUnrecoverablePaymentHoldsNeitherCronNorWake() public {
        _enable(_program(P.PAYMENT, _path(_action(P.SEND, 2e6, RECIPIENT))));
        usdc.mint(address(vault), 5e6);
        _syncBudget(1e6, 1e6, 1);
        uint256 subsBefore = system.subscribeCount();

        IReactive.LogRecord memory payment = _paymentLog(101, 2e6);
        vm.prank(address(system));
        agent.react(payment);

        assertEq(agent.pendingRuns(WORKFLOW), 1);
        assertEq(agent.wakeBlock(WORKFLOW), 0, "unrecoverable amount pins no wake");
        assertEq(system.subscribeCount(), subsBefore, "neither cron nor wake is subscribed");

        vm.warp(vm.getBlockTimestamp() + 7 days + 10 minutes);
        _cron(1);
        assertEq(system.requestCount(), 0, "still unrecoverable after week reset");

        _syncBudget(3e6, 0, 2);
        assertEq(system.requestCount(), 1, "raising limit above path cost dispatches parked run");
        assertEq(agent.pendingRuns(WORKFLOW), 0);
    }

    function testMaxUintPercentTransferDoesNotOverflowMirror() public {
        P.Action memory send = P.Action(P.SEND, P.PERCENT, 5_000, RECIPIENT);
        P.Program memory program = _program(P.PAYMENT, _path(send));
        program.usdcCap = 2e6;
        _enable(program);
        _syncBudget(1e6, 0.5e6, 1);

        // B-8: PERCENT share exceeding program.usdcCap is rejected before parking/dispatching.
        IReactive.LogRecord memory payment = _paymentLog(101, type(uint256).max);
        vm.prank(address(system));
        agent.react(payment);
        assertEq(agent.pendingRuns(WORKFLOW), 0);
        assertEq(system.requestCount(), 0);

        // And validator.budgetBlocks handles type(uint256).max safely without overflow.
        uint256[] memory plan = new uint256[](1);
        plan[0] = (uint256(5_000) << 208) | (uint256(1) << 224);
        assertTrue(
            agent.validator()
                .budgetBlocks(
                    1e6,
                    0,
                    0.5e6,
                    0,
                    uint64(block.timestamp),
                    plan,
                    type(uint256).max,
                    uint64(block.timestamp)
                )
        );
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
        address payer = address(0xBA11);
        P.Action memory send = P.Action(P.SEND, P.PERCENT, 2500, RECIPIENT);
        P.Program memory program = _program(P.PAYMENT, _branch(P.PAYMENT_FROM, 0, send));
        program.subject = payer;
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
        assertEq(system.requestCount(), 0, "wrong sender is filtered before callback");

        P.Run memory wrongSenderRun = _run(101, P.PAYMENT, 3e6);
        wrongSenderRun.actor = RECIPIENT;
        assertEq(_deliver(wrongSenderRun), vault.SKIPPED());

        payment.topic_1 = uint160(payer);
        // B-8: Agent refuses to dispatch when PERCENT share (25% of 8e6 = 2e6) exceeds usdcCap (1e6).
        payment.block_number = 102;
        payment.tx_hash = 102;
        payment.data = abi.encode(8e6);
        vm.prank(address(system));
        agent.react(payment);
        assertEq(
            system.requestCount(), 0, "over-cap percentage payment is filtered before callback"
        );

        P.Run memory overCapRun = _run(102, P.PAYMENT, 8e6);
        overCapRun.actor = payer;
        assertEq(_deliver(overCapRun), vault.FAILED());

        payment.block_number = 103;
        payment.tx_hash = 103;
        payment.data = abi.encode(3e6);
        vm.prank(address(system));
        agent.react(payment);
        _deliverRequest(0);
        assertEq(vault.outcomes(_runId(payment.tx_hash)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(RECIPIENT), 0.75e6);
    }

    function testOwnerFundingIsNeitherDispatchedNorSettledAsPayment() public {
        _enable(_program(P.PAYMENT, _path(_action(P.SEND, 1e6, RECIPIENT))));
        usdc.mint(address(vault), 10e6);
        IReactive.LogRecord memory deposit = _paymentLog(101, 5e6);
        deposit.topic_1 = uint160(OWNER);
        vm.prank(address(system));
        agent.react(deposit);
        assertEq(system.requestCount(), 0);

        P.Run memory oldCallback = _run(101, P.PAYMENT, 5e6);
        oldCallback.actor = OWNER;
        assertEq(_deliver(oldCallback), vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), 0);
    }

    function testDipSignalIsConsumedOnlyAfterOneTrade() public {
        _enable(_program(P.SCHEDULE, _branch(P.DIP_BY, 500, _action(P.BUY, 1e6, address(0)))));
        usdc.mint(address(vault), 3e6);
        // First tick seeds reference baseline at $2,000 without buying.
        _price(2_000_000);
        assertEq(_deliver(_run(101, P.SCHEDULE, 0)), vault.SKIPPED());
        // 5% dip to $1,900 triggers one buy and resets baseline to $1,900.
        _price(1_900_000);
        assertEq(_deliver(_run(102, P.SCHEDULE, 0)), vault.CONFIRMED());
        // Repeating tick at $1,900 does not double-buy.
        assertEq(_deliver(_run(103, P.SCHEDULE, 0)), vault.SKIPPED());
        // Recovery to $2,100 raises the reference baseline cleanly.
        _price(2_100_000);
        assertEq(_deliver(_run(104, P.SCHEDULE, 0)), vault.SKIPPED());
        // Next >=5% dip back to $1,900 buys again.
        _price(1_900_000);
        assertEq(_deliver(_run(105, P.SCHEDULE, 0)), vault.CONFIRMED());
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
        assertEq(_deliver(_run(101, P.PRICE, 2.3e18)), vault.SKIPPED());
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
        assertEq(system.unsubscribeCount(), 4);
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
        _sync(102, 2_000_000);
        _sync(103, 2_000_000);
        assertEq(system.requestCount(), 0, "rising prices do not waste callbacks");
        _sync(104, 1_500_000);
        assertEq(system.requestCount(), 1, "drawdown dispatches once with the recorded peak");
        _price(1_500_000);
        _deliverRequest(0);
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
        assertEq(system.requestCount(), 0, "no pre-authorization peak can trigger a callback");
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
        assertEq(system.requestCount(), 0, "equal-to-threshold transfer filtered pre-callback");
        assertEq(_deliver(_run(102, P.TRANSFER, 2e6)), vault.SKIPPED());
        transfer.data = abi.encode(type(uint256).max);
        transfer.tx_hash = 103;
        vm.prank(address(system));
        agent.react(transfer);
        _deliverRequest(0);
        assertEq(vault.outcomes(_runId(transfer.tx_hash)), vault.CONFIRMED());
        vm.prank(address(system));
        agent.react(transfer);
        assertEq(system.requestCount(), 1);
    }

    function testRefillPullsOnlyTheDeficitAndRespectsAllowance() public {
        _enable(
            _program(P.SCHEDULE, _branch(P.USDC_BELOW, 2e6, _action(P.REFILL, 1e6, address(0))))
        );
        usdc.mint(OWNER, 5e6);
        usdc.mint(address(vault), 1.8e6);
        assertEq(_deliver(_run(101, P.SCHEDULE, 0)), vault.SKIPPED());
        vm.prank(OWNER);
        usdc.approve(address(vault), 1e6);
        assertEq(_deliver(_run(102, P.SCHEDULE, 0)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(address(vault)), 2e6);
        assertEq(usdc.balanceOf(OWNER), 4.8e6);
        assertEq(_deliver(_run(103, P.SCHEDULE, 0)), vault.SKIPPED());
    }

    function testSendBeyondTheVaultBalanceIsSkippedAndSpendsNothing() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))));
        usdc.mint(address(vault), 0.4e6);
        bytes32 runId = keccak256(
            abi.encode(address(agent), WORKFLOW, LASNA, bytes32(uint256(101)), uint64(0))
        );
        vm.expectEmit(true, true, false, true, address(vault));
        emit WorkflowVaultV2.Outcome(
            WORKFLOW,
            runId,
            1,
            vault.SKIPPED(),
            type(uint8).max,
            WorkflowVaultV2.InsufficientVaultBalance.selector
        );
        assertEq(_deliver(_run(101, P.SCHEDULE, 0)), vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), 0);
        assertEq(usdc.balanceOf(address(vault)), 0.4e6);
        (,, uint128 usdcSpent,,,,,) = vault.weeklyBudget(WORKFLOW);
        assertEq(usdcSpent, 0, "a skipped run spends no budget");
    }

    function testBuyBeyondTheVaultUsdcIsSkipped() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.BUY, 1e6, address(0)))));
        _price(2_000_000);
        usdc.mint(address(vault), 0.4e6);
        assertEq(_deliver(_run(101, P.SCHEDULE, 0)), vault.SKIPPED());
        assertEq(router.swapCount(), 0, "no swap is attempted without the input token");
        assertEq(usdc.balanceOf(address(vault)), 0.4e6);
    }

    function testSellBeyondTheVaultWethIsSkipped() public {
        _enable(_program(P.SCHEDULE, _path(_action(P.SELL, 0.1 ether, address(0)))));
        _price(2_000_000);
        weth.mint(address(vault), 0.05 ether);
        assertEq(_deliver(_run(101, P.SCHEDULE, 0)), vault.SKIPPED());
        assertEq(router.swapCount(), 0);
        assertEq(weth.balanceOf(address(vault)), 0.05 ether);
    }

    function testSellCanFundALaterSendInTheSamePath() public {
        // The validator allows one swap per path, so the ordering case that matters is a sale that
        // funds the USDC a later transfer moves. An upfront aggregate balance check would wrongly
        // skip this run even though it settles.
        P.Node[] memory nodes = new P.Node[](1);
        nodes[0].actions = new P.Action[](2);
        nodes[0].actions[0] = _action(P.SELL, 0.1 ether, address(0));
        nodes[0].actions[1] = _action(P.SEND, 0.15e6, RECIPIENT);
        _price(2_000_000);
        _enable(_program(P.SCHEDULE, nodes));
        weth.mint(address(vault), 0.1 ether);
        assertEq(usdc.balanceOf(address(vault)), 0, "the send is funded by the sale in this run");
        assertEq(_deliver(_run(101, P.SCHEDULE, 0)), vault.CONFIRMED());
        assertEq(router.swapCount(), 1);
        assertEq(usdc.balanceOf(RECIPIENT), 0.15e6);
    }

    function testFuzzSendIsSkippedExactlyWhenTheVaultCannotCoverIt(uint96 balance, uint96 amount)
        public
    {
        balance = uint96(bound(balance, 0, 3e6));
        amount = uint96(bound(amount, 1, 2e6));
        _enable(_program(P.SCHEDULE, _path(_action(P.SEND, amount, RECIPIENT))));
        usdc.mint(address(vault), balance);
        bool covered = balance >= amount;
        assertEq(_deliver(_run(101, P.SCHEDULE, 0)), covered ? vault.CONFIRMED() : vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), covered ? amount : 0);
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
        assertEq(_deliver(_run(105, P.SCHEDULE, 0)), vault.IN_GRACE_PERIOD());
        uint64 readyAt = vault.payoutReadyAt(WORKFLOW);
        vm.warp(readyAt - 1);
        P.Run memory early = _run(106, P.SCHEDULE, 0);
        vm.warp(readyAt);
        assertEq(_deliver(early), vault.IN_GRACE_PERIOD());
        assertEq(_deliver(_run(107, P.SCHEDULE, 0)), vault.CONFIRMED());
        assertEq(_deliver(_run(108, P.SCHEDULE, 0)), vault.SKIPPED());
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

    function testPricePreFilterSuppressesUnmatchedSwapsAcrossAllChecks() public {
        // Compound tree: PRICE_AT_MOST 1900 -> USDC_BELOW 5e6 -> BUY, else SKIP.
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = _check(P.PRICE_AT_MOST, 1.9e18, 0, 1, 4);
        nodes[1] = _check(P.USDC_BELOW, 5e6, 0, 2, 3);
        nodes[2] = _leaf(_action(P.BUY, 1e6, address(0)));
        P.Program memory compound = _program(P.PRICE, nodes);
        _enable(compound);
        usdc.mint(address(vault), 3e6);

        // Non-matching prices dispatch zero callbacks even though USDC_BELOW is unknown to the Agent.
        _sync(101, 2_100_000);
        _sync(102, 1_950_000);
        assertEq(system.requestCount(), 0);

        // Matching price dispatches conservatively through USDC_BELOW.
        _price(1_900_000);
        _sync(103, 1_900_000);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0);
        assertEq(router.swapCount(), 1);

        // Validator direct checks for non-PRICE trigger and zero observed price.
        WorkflowProgramValidatorV2 validator = agent.validator();
        bytes memory schedEncoded =
            abi.encode(_program(P.SCHEDULE, _path(_action(P.SEND, 1e6, RECIPIENT))));
        assertFalse(validator.canTriggerPrice(schedEncoded, 2e18, 0, 0, 0));
        assertFalse(validator.canTriggerPrice(abi.encode(compound), 0, 0, 0, 0));

        // PRICE_AT_LEAST, PRICE_BELOW, PRICE_OUTSIDE, PRICE_RISES_THROUGH, PRICE_FALLS_THROUGH.
        bytes32 wfRange = keccak256("range-precheck");
        P.Node[] memory rangeNodes =
            _branch(P.PRICE_OUTSIDE, 1.8e18, _action(P.ALERT, 0, address(0)));
        rangeNodes[0].upper = 2.2e18;
        P.Program memory rangeProg = _program(P.PRICE, rangeNodes);
        rangeProg.once = true;
        bytes memory rangeEncoded = abi.encode(rangeProg);
        vm.startPrank(OWNER);
        vault.authorize(wfRange, 1, rangeEncoded, "Range");
        agent.enable(wfRange, 1, rangeEncoded, "Range", uint64(block.number));
        vm.stopPrank();
        _sync(104, 2_000_000);
        assertEq(system.requestCount(), 1, "inside range is filtered");
        _sync(105, 2_300_000);
        assertEq(system.requestCount(), 2, "outside range dispatches");
        vm.prank(OWNER);
        agent.disable(wfRange, 1);

        bytes32 wfCross = keccak256("cross-precheck");
        P.Program memory crossProg = _program(
            P.PRICE, _branch(P.PRICE_RISES_THROUGH, 2.5e18, _action(P.ALERT, 0, address(0)))
        );
        bytes memory crossEncoded = abi.encode(crossProg);
        vm.startPrank(OWNER);
        vault.authorize(wfCross, 1, crossEncoded, "Cross");
        agent.enable(wfCross, 1, crossEncoded, "Cross", uint64(block.number));
        vm.stopPrank();
        _sync(106, 2_400_000);
        _sync(107, 2_450_000);
        assertEq(system.requestCount(), 2, "below target cross does not dispatch");
        _sync(108, 2_500_000);
        assertEq(system.requestCount(), 3, "crossing target dispatches");
    }

    function testPriceCooldownThrottlesBackToBackSwapsAndPreservesHighs() public {
        P.Program memory program = _program(
            P.PRICE, _branch(P.PRICE_AT_LEAST, 2e18, _action(P.SELL, 0.1 ether, address(0)))
        );
        _enable(program);
        weth.mint(address(vault), 1 ether);
        _price(2_100_000);

        // First matching swap dispatches and starts PRICE_COOLDOWN.
        _sync(101, 2_100_000);
        assertEq(system.requestCount(), 1);
        (,,, uint40 until,) = agent.meta(WORKFLOW);
        assertEq(until, block.timestamp + agent.PRICE_COOLDOWN());

        // Consecutive matching swaps within 60s are throttled without spamming callbacks.
        vm.warp(vm.getBlockTimestamp() + 10);
        _sync(102, 2_200_000);
        vm.warp(vm.getBlockTimestamp() + 49);
        _sync(103, 2_300_000);
        assertEq(system.requestCount(), 1, "swaps inside cooldown are suppressed");

        // Once cooldown expires, the next matching swap dispatches again.
        vm.warp(vm.getBlockTimestamp() + 1);
        _sync(104, 2_400_000);
        assertEq(system.requestCount(), 2, "swap after cooldown dispatches");

        // Re-enabling clears cooldown immediately.
        bytes memory encoded = abi.encode(program);
        vm.startPrank(OWNER);
        vault.authorize(WORKFLOW, 2, encoded, "Workflow V2");
        agent.enable(WORKFLOW, 2, encoded, "Workflow V2", uint64(block.number));
        vm.stopPrank();
        (,,, uint40 resetUntil,) = agent.meta(WORKFLOW);
        assertEq(resetUntil, 0);
    }

    function testDistinctCrossingSettlesDuringCooldownWithoutAnotherSwap() public {
        _enable(
            _program(P.PRICE, _branch(P.PRICE_FALLS_THROUGH, 2e18, _action(P.ALERT, 0, address(0))))
        );
        _sync(101, 2_100_000);
        _price(1_950_000);
        _sync(102, 1_950_000);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0);
        _sync(103, 2_050_000);
        _sync(104, 1_950_000);
        assertEq(system.requestCount(), 2);
        _deliverRequest(1);
        assertEq(vault.outcomes(_runId(104)), vault.CONFIRMED());
        _sync(105, 1_950_000);
        vm.warp(vm.getBlockTimestamp() + agent.PRICE_COOLDOWN());
        _sync(106, 1_950_000);
        assertEq(system.requestCount(), 2);
    }

    function testCooldownCrossingCannotSettleANonCrossingSpendingPath() public {
        P.Node[] memory nodes =
            _branch(P.PRICE_FALLS_THROUGH, 2e18, _action(P.ALERT, 0, address(0)));
        nodes[2] = _leaf(_action(P.SEND, 1e6, RECIPIENT));
        _enable(_program(P.PRICE, nodes));
        usdc.mint(address(vault), 2e6);

        _price(2_100_000);
        _sync(101, 2_100_000);
        _deliverRequest(0);
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);

        _sync(102, 1_950_000);
        assertEq(system.requestCount(), 2);
        _deliverRequest(1);
        assertEq(vault.outcomes(_runId(102)), vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);
    }

    function testTrailingUpdatesPeakDuringCooldownAndTriggersOnRecoveryAfterCooldown() public {
        P.Program memory program =
            _program(P.PRICE, _branch(P.TRAILING, 1_000, _action(P.SELL, 0.1 ether, address(0))));
        _enable(program);
        weth.mint(address(vault), 1 ether);

        _sync(101, 2_000_000);
        _sync(102, 2_000_000);
        _sync(103, 1_800_000);
        assertEq(system.requestCount(), 1);

        // Inside cooldown: price rallies to 3_000 across 2 blocks then drops to 2_500;
        // cooldown throttles 2_500 but highs[workflow] still records sustained 3_000.
        vm.warp(vm.getBlockTimestamp() + 10);
        _sync(104, 3_000_000);
        _sync(105, 3_000_000);
        _sync(106, 2_500_000);
        assertEq(system.requestCount(), 1);

        vm.warp(vm.getBlockTimestamp() + agent.PRICE_COOLDOWN());
        _sync(107, 2_600_000);
        assertEq(system.requestCount(), 2);
        CallbackConfiguration memory req = system.requestAt(1);
        (,, P.Run memory decoded) = abi.decode(_slice(req.payload, 4), (address, bytes32, P.Run));
        assertEq(decoded.high, 3e18, "highs[workflow] kept updating during cooldown");
    }

    function testReferenceSyncedUpdatesPriceBandMirrorAndFiltersIntermediateSwaps() public {
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = _check(P.ABOVE_REFERENCE, 1_000, 2e18, 1, 2);
        nodes[1] = _leaf(_action(P.SELL, 0.1 ether, address(0)));
        nodes[2] = _check(P.BELOW_REFERENCE, 1_000, 2e18, 3, 4);
        nodes[3] = _leaf(_action(P.BUY, 1e6, address(0)));
        _enable(_program(P.PRICE, nodes));
        usdc.mint(address(vault), 5e6);
        weth.mint(address(vault), 1 ether);

        // Intermediate prices around initial reference (2.0) dispatch zero callbacks.
        _sync(101, 2_050_000);
        _sync(102, 1_850_000);
        assertEq(system.requestCount(), 0);

        // Price >= 2.2 triggers SELL and emits ReferenceSynced(2.25).
        _price(2_250_000);
        _sync(103, 2_250_000);
        assertEq(system.requestCount(), 1);
        vm.recordLogs();
        _deliverRequest(0);
        assertEq(router.swapCount(), 1);

        // Forward ReferenceSynced to Agent (ignore stale/wrong-epoch/zero logs first).
        uint256 refSig = uint256(keccak256("ReferenceSynced(bytes32,uint64,uint128)"));
        IReactive.LogRecord memory badRef;
        badRef.chain_id = P.UNICHAIN_SEPOLIA;
        badRef._contract = address(vault);
        badRef.topic_0 = refSig;
        badRef.topic_1 = uint256(WORKFLOW);
        badRef.topic_2 = 999; // wrong epoch
        badRef.block_number = 50;
        badRef.data = abi.encode(uint128(2.25e18));
        vm.prank(address(system));
        agent.react(badRef);
        (uint128 refBefore,,,,) = agent.meta(WORKFLOW);
        assertEq(refBefore, 0);

        _forwardReferenceSynced(10);
        (uint128 refAfter,,,,) = agent.meta(WORKFLOW);
        assertEq(refAfter, 2.25e18);

        // Stale older ReferenceSynced cannot overwrite newer reference.
        badRef.topic_2 = 1;
        badRef.block_number = 5;
        badRef.data = abi.encode(uint128(1.5e18));
        vm.prank(address(system));
        agent.react(badRef);
        (uint128 refStill,,,,) = agent.meta(WORKFLOW);
        assertEq(refStill, 2.25e18);

        // Advance past cooldown: price 2.1 (would have matched old 2.0 band, but inside 2.25 +/- 10%
        // [2.025, 2.475]) is filtered out!
        vm.warp(vm.getBlockTimestamp() + agent.PRICE_COOLDOWN() + 1);
        _sync(104, 2_100_000);
        assertEq(system.requestCount(), 1, "prices inside updated band are filtered");

        // Price 2.0 (<= 2.25 * 0.9 = 2.025) triggers BUY!
        _price(2_000_000);
        _sync(105, 2_000_000);
        assertEq(system.requestCount(), 2, "crossing updated lower band dispatches");
        _deliverRequest(1);
        assertEq(router.swapCount(), 2);
    }

    function testDynamicReferenceSeedsOnFirstObservationThenSyncs() public {
        // Dynamic reference (node.upper == 0): Agent allows the first observation through so the
        // Vault can seed memory_.referencePrice and emit ReferenceSynced even on a SKIPPED leaf.
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = _check(P.ABOVE_REFERENCE, 1_000, 0, 1, 2);
        nodes[1] = _leaf(_action(P.SELL, 0.1 ether, address(0)));
        nodes[2] = _check(P.BELOW_REFERENCE, 1_000, 0, 3, 4);
        nodes[3] = _leaf(_action(P.BUY, 1e6, address(0)));
        _enable(_program(P.PRICE, nodes));
        usdc.mint(address(vault), 5e6);

        _price(2_000_000);
        _sync(101, 2_000_000);
        assertEq(system.requestCount(), 1);
        vm.recordLogs();
        _deliverRequest(0);
        assertEq(vault.outcomes(_runId(101)), vault.SKIPPED());
        _forwardReferenceSynced(10);
        (uint128 seeded,,,,) = agent.meta(WORKFLOW);
        assertEq(seeded, 2e18);

        vm.warp(vm.getBlockTimestamp() + agent.PRICE_COOLDOWN() + 1);
        _sync(102, 2_050_000);
        assertEq(system.requestCount(), 1, "intermediate swap filtered after seed");
    }

    function testSettlementFiltersScopeBudgetSyncedAndSkipAlertOnlyWorkflows() public {
        uint256 subsBefore = system.subscribeCount();
        P.Program memory alertProg =
            _program(P.PRICE, _branch(P.PRICE_AT_LEAST, 2e18, _action(P.ALERT, 0, address(0))));
        alertProg.once = true;
        _enable(alertProg);
        // Subscribed ONLY to CLOSED and pair Sync (2 subscriptions, NO BUDGET_SYNCED, NO REFERENCE_SYNCED).
        assertEq(system.subscribeCount(), subsBefore + 2);
        assertFalse(system.isSubscribed(P.UNICHAIN_SEPOLIA, address(vault), BUDGET_SYNCED));
        assertTrue(
            system.isSubscribed(
                P.UNICHAIN_SEPOLIA, address(vault), uint256(keccak256("Closed(bytes32,uint64)"))
            )
        );
    }

    function testMixedReferenceTreeAndStaticReferenceSeedStayInSync() public {
        // Case A: dynamic ABOVE_REFERENCE (upper=0) -> descendant ABOVE_REFERENCE (upper=3000) with
        // executable `no` leaf must dispatch at 3200 so Vault seeds memory_.referencePrice=3200.
        P.Node[] memory mixedNodes = new P.Node[](5);
        mixedNodes[0] = _check(P.ABOVE_REFERENCE, 1_000, 0, 1, 2);
        mixedNodes[2] = _check(P.ABOVE_REFERENCE, 500, 3e18, 3, 4);
        mixedNodes[4] = _leaf(_action(P.ALERT, 0, address(0)));
        bytes32 wfMixed = keccak256("mixed-ref");
        bytes memory mixedEncoded = abi.encode(_program(P.PRICE, mixedNodes));
        vm.startPrank(OWNER);
        vault.authorize(wfMixed, 1, mixedEncoded, "MixedRef");
        agent.enable(wfMixed, 1, mixedEncoded, "MixedRef", uint64(block.number));
        vm.stopPrank();
        _price(3_200_000);
        _sync(101, 3_200_000);
        assertEq(system.requestCount(), 1, "mixed dynamic->static reference tree dispatches");
        _deliverRequest(0);
        bytes32 mixedRunId = keccak256(
            abi.encode(
                address(agent), wfMixed, P.UNICHAIN_SEPOLIA, bytes32(uint256(101)), uint64(0)
            )
        );
        assertEq(vault.outcomes(mixedRunId), vault.CONFIRMED());

        // Case B: static upper (2500) emits ReferenceSynced on first 0 -> 2500 transition even when SKIPPED.
        vm.prank(OWNER);
        agent.disable(wfMixed, 1);
        P.Node[] memory distinctNodes = new P.Node[](5);
        distinctNodes[0] = _check(P.ABOVE_REFERENCE, 1_000, 2.5e18, 1, 2);
        distinctNodes[2] = _check(P.BELOW_REFERENCE, 1_000, 1.8e18, 3, 4);
        distinctNodes[3] = _leaf(_action(P.ALERT, 0, address(0)));
        _enable(_program(P.PRICE, distinctNodes));
        _price(2_400_000);
        _sync(102, 2_400_000);
        assertEq(system.requestCount(), 1);
        vm.recordLogs();
        assertEq(_deliver(_run(102, P.PRICE, 2.4e18)), vault.SKIPPED());
        _forwardReferenceSynced(20);
        (uint128 mirrored,,,,) = agent.meta(WORKFLOW);
        assertEq(mirrored, 2.5e18, "Vault static seed syncs ReferenceSynced to Agent");
    }

    function testDelayedReferenceSyncedDoesNotSuppressValidOppositeBandAfterCooldown() public {
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = _check(P.ABOVE_REFERENCE, 1_000, 2e18, 1, 2);
        nodes[1] = _leaf(_action(P.SELL, 0.1 ether, address(0)));
        nodes[2] = _check(P.BELOW_REFERENCE, 1_000, 2e18, 3, 4);
        nodes[3] = _leaf(_action(P.BUY, 1e6, address(0)));
        _enable(_program(P.PRICE, nodes));
        usdc.mint(address(vault), 5e6);
        weth.mint(address(vault), 1 ether);

        _price(2_250_000);
        _sync(101, 2_250_000);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0);
        // Intentionally do NOT forward ReferenceSynced yet; advance past PRICE_COOLDOWN.
        vm.warp(vm.getBlockTimestamp() + agent.PRICE_COOLDOWN() + 1);

        // Price 2.01 triggers BELOW_REFERENCE against Vault's 2.25 even though node.upper is 2.0.
        _price(2_010_000);
        _sync(102, 2_010_000);
        assertEq(system.requestCount(), 2, "in-flight ReferenceSynced keeps opposite band open");
        _deliverRequest(1);
        assertEq(router.swapCount(), 2);
    }

    function testCompoundTrailingWithHigherPeakBranchAvoidsFalseNegative() public {
        // Custom tree: PRICE_AT_LEAST 2500 -> ALERT, else TRAILING 10% -> SELL.
        // Vault.memory_.peak can be raised to 2600 by ALERT even if block 102 is overwritten in same block.
        P.Node[] memory nodes = new P.Node[](5);
        nodes[0] = _check(P.PRICE_AT_LEAST, 2.5e18, 0, 1, 2);
        nodes[1] = _leaf(_action(P.ALERT, 0, address(0)));
        nodes[2] = _check(P.TRAILING, 1_000, 0, 3, 4);
        nodes[3] = _leaf(_action(P.SELL, 0.1 ether, address(0)));
        _enable(_program(P.PRICE, nodes));
        weth.mint(address(vault), 1 ether);

        _price(2_600_000);
        _sync(101, 2_600_000);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0); // Vault memory_.peak = 2.6e18

        // Same-block overwrite prevents highs[workflow] from seeing 2.6e18, then cooldown expires.
        _sync(101, 2_400_000);
        vm.warp(vm.getBlockTimestamp() + agent.PRICE_COOLDOWN() + 1);
        // 2.34 <= 2.6 * 0.9: Vault confirms even though Agent highs[workflow] == 0.
        _price(2_340_000);
        _sync(102, 2_340_000);
        assertEq(system.requestCount(), 2, "compound trailing with higher-peak branch dispatches");
        _deliverRequest(1);
        assertEq(router.swapCount(), 1);
    }

    function testInactivityPausedPreservesWatchAndValidatesCheckInOrdering() public {
        P.Program memory inactProg = _program(
            P.SCHEDULE, _branch(P.INACTIVITY, 1 days, _action(P.INACTIVITY_PAYOUT, 1e6, RECIPIENT))
        );
        inactProg.once = true;
        _enable(inactProg);
        usdc.mint(address(vault), 2e6);
        uint256 start = vm.getBlockTimestamp();

        // Pause inactivity workflow on budget exhaustion.
        _syncBudget(1e6, 1e6, 1);
        assertTrue(agent.watchingPaused(WORKFLOW));

        // Real human activity (OWNER -> RECIPIENT USDC Transfer) while paused MUST still be recorded.
        vm.warp(start + 12 hours);
        IReactive.LogRecord memory transfer = _paymentLog(601, 10e6);
        transfer.topic_1 = uint160(OWNER);
        transfer.topic_2 = uint160(RECIPIENT);
        vm.prank(address(system));
        agent.react(transfer);

        // Increase budget and resume, then reach grace period.
        _syncBudget(2e6, 1e6, 2);
        if (agent.watchingPaused(WORKFLOW)) agent.resumeWatching(WORKFLOW);
        assertFalse(agent.watchingPaused(WORKFLOW));

        // Stale run with older activityTime does NOT reset eligibleAt once grace starts.
        vm.warp(start + 1 days + 12 hours + 1 minutes);
        P.Run memory staleRun = _run(602, P.SCHEDULE, 0);
        staleRun.activityTime = uint64(start);
        assertEq(_deliver(staleRun), vault.IN_GRACE_PERIOD());
        (,,,, uint64 eligibleBefore,,,) = vault.workflowMemory(WORKFLOW);
        assertGt(eligibleBefore, 0);

        vm.prank(OWNER);
        vault.checkIn(WORKFLOW);
        (,, uint64 checkInAt,, uint64 eligibleAfterCheckIn,,,) = vault.workflowMemory(WORKFLOW);
        assertEq(eligibleAfterCheckIn, 0);
        assertGt(checkInAt, start + 1 days);
    }

    function testOutOfOrderCrossingCallbacksDoNotTriggerStaleObservation() public {
        P.Program memory fallProg = _program(
            P.PRICE, _branch(P.PRICE_FALLS_THROUGH, 2e18, _action(P.SEND, 1e6, RECIPIENT))
        );
        fallProg.once = true;
        _enable(fallProg);
        usdc.mint(address(vault), 5e6);

        // Newer non-crossing callback N+1 arrives FIRST (SKIPPED): must NOT lock out earlier crossing N.
        _price(1_950_000);
        P.Run memory runNPlus1 = _run(701, P.PRICE, 1.95e18);
        runNPlus1.previous = 1.98e18;
        runNPlus1.originBlock = 200;
        runNPlus1.originLogIndex = 5;
        assertEq(_deliver(runNPlus1), vault.SKIPPED());

        // Earlier crossing callback N now arrives out-of-order: succeeds without StaleObservation!
        _price(1_980_000);
        P.Run memory runN = _run(702, P.PRICE, 1.98e18);
        runN.previous = 2.02e18;
        runN.originBlock = 199;
        runN.originLogIndex = 1;
        assertEq(_deliver(runN), vault.CONFIRMED());
        assertEq(usdc.balanceOf(RECIPIENT), 1e6);

        // Same guarantees for PRICE_RISES_THROUGH.
        P.Program memory riseProg = _program(
            P.PRICE, _branch(P.PRICE_RISES_THROUGH, 2e18, _action(P.SEND, 1e6, RECIPIENT))
        );
        riseProg.once = false;
        bytes memory encoded = abi.encode(riseProg);
        bytes32 riseId = keccak256("out of order rise");
        vm.startPrank(OWNER);
        vault.authorize(riseId, 1, encoded, "Rise OOO");
        agent.enable(riseId, 1, encoded, "Rise OOO", uint64(block.number));
        vm.stopPrank();

        _price(2_050_000);
        P.Run memory riseNPlus1 = _run(703, P.PRICE, 2.05e18);
        riseNPlus1.programHash = keccak256(encoded);
        riseNPlus1.previous = 2.02e18;
        riseNPlus1.originBlock = 300;
        riseNPlus1.originLogIndex = 5;
        vm.prank(PROXY);
        vault.execute(address(agent), riseId, riseNPlus1);
        assertEq(
            vault.outcomes(
                keccak256(
                    abi.encode(
                        address(agent),
                        riseId,
                        riseNPlus1.originChain,
                        riseNPlus1.originTransaction,
                        uint64(5)
                    )
                )
            ),
            vault.SKIPPED()
        );

        _price(2_020_000);
        P.Run memory riseN = _run(704, P.PRICE, 2.02e18);
        riseN.programHash = keccak256(encoded);
        riseN.previous = 1.98e18;
        riseN.originBlock = 299;
        riseN.originLogIndex = 1;
        vm.prank(PROXY);
        vault.execute(address(agent), riseId, riseN);
        assertEq(
            vault.outcomes(
                keccak256(
                    abi.encode(
                        address(agent),
                        riseId,
                        riseN.originChain,
                        riseN.originTransaction,
                        uint64(1)
                    )
                )
            ),
            vault.CONFIRMED()
        );
        assertEq(usdc.balanceOf(RECIPIENT), 2e6);

        // Truly older observation AFTER CONFIRMED still reverts StaleObservation in settle() -> SKIPPED(StaleObservation).
        P.Run memory trulyStale = _run(705, P.PRICE, 2.02e18);
        trulyStale.programHash = keccak256(encoded);
        trulyStale.previous = 1.98e18;
        trulyStale.originBlock = 298;
        trulyStale.originLogIndex = 0;
        bytes32 staleId = keccak256(
            abi.encode(
                address(agent),
                riseId,
                trulyStale.originChain,
                trulyStale.originTransaction,
                uint64(0)
            )
        );
        vm.expectEmit(true, true, false, true, address(vault));
        emit WorkflowVaultV2.Outcome(
            riseId,
            staleId,
            1,
            vault.SKIPPED(),
            type(uint8).max,
            WorkflowVaultV2.StaleObservation.selector
        );
        vm.prank(PROXY);
        vault.execute(address(agent), riseId, trulyStale);
        assertEq(vault.outcomes(staleId), vault.SKIPPED());
    }

    function testRefillClampsToAllowanceAndBalanceAndSkipsOnZeroBalance() public {
        _enable(
            _program(P.SCHEDULE, _branch(P.USDC_BELOW, 2e6, _action(P.REFILL, 1e6, address(0))))
        );
        usdc.mint(address(vault), 1e6);

        // 1. Owner balance == 0 even with approval -> SKIPPED(InsufficientOwnerBalance).
        vm.prank(OWNER);
        usdc.approve(address(vault), 5e6);
        assertEq(_deliver(_run(801, P.SCHEDULE, 0)), vault.SKIPPED());

        // 2. Owner balance > 0, allowance == 0 -> SKIPPED(InsufficientRefillAllowance).
        usdc.mint(OWNER, 5e6);
        vm.prank(OWNER);
        usdc.approve(address(vault), 0);
        assertEq(_deliver(_run(802, P.SCHEDULE, 0)), vault.SKIPPED());

        // 3. Partial allowance clamps pull to 0.3e6 instead of reverting.
        vm.prank(OWNER);
        usdc.approve(address(vault), 0.3e6);
        assertEq(_deliver(_run(803, P.SCHEDULE, 0)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(address(vault)), 1.3e6);

        // 4. Partial owner balance clamps pull to owner's remaining 0.2e6 instead of reverting.
        vm.prank(OWNER);
        usdc.transfer(RECIPIENT, 4.5e6); // owner left with 0.2e6
        vm.prank(OWNER);
        usdc.approve(address(vault), 5e6);
        assertEq(_deliver(_run(804, P.SCHEDULE, 0)), vault.CONFIRMED());
        assertEq(usdc.balanceOf(address(vault)), 1.5e6);
        assertEq(usdc.balanceOf(OWNER), 0);
    }

    function testInactivityLongIntervalEmitsGraceStartedAndPullsNextDueForward() public {
        P.Program memory prog = _program(
            P.SCHEDULE, _branch(P.INACTIVITY, 2 days, _action(P.INACTIVITY_PAYOUT, 1e6, RECIPIENT))
        );
        prog.once = true;
        prog.interval = 30 days;
        _enable(prog);
        usdc.mint(address(vault), 2e6);

        vm.warp(vm.getBlockTimestamp() + 2 days + 1 minutes);
        vm.recordLogs();
        _cron(1);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0);
        (,,,, uint64 eligibleAt,,,) = vault.workflowMemory(WORKFLOW);
        assertGt(eligibleAt, 0);

        // Forward GraceStarted to Agent -> nextDue pulls forward to eligibleAt + GRACE_SKEW (2 min).
        uint256 graceSig = uint256(keccak256("GraceStarted(bytes32,uint64,uint64)"));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vault) && logs[i].topics[0] == bytes32(graceSig)) {
                IReactive.LogRecord memory gLog;
                gLog.chain_id = P.UNICHAIN_SEPOLIA;
                gLog._contract = address(vault);
                gLog.topic_0 = graceSig;
                gLog.topic_1 = uint256(logs[i].topics[1]);
                gLog.topic_2 = uint256(logs[i].topics[2]);
                gLog.data = logs[i].data;
                gLog.block_number = block.number;
                gLog.tx_hash = 900 + i;
                gLog.log_index = i;
                vm.prank(address(system));
                agent.react(gLog);
            }
        }

        // Opens the final confirmation window without waiting 30 days.
        vm.warp(eligibleAt + 2 minutes);
        _cron(2);
        assertEq(system.requestCount(), 2, "nextDue pulled forward past 24h grace");
        _deliverRequest(1);
        uint64 readyAt = vault.payoutReadyAt(WORKFLOW);
        assertGt(readyAt, eligibleAt);
        assertEq(usdc.balanceOf(RECIPIENT), 0);

        vm.warp(vm.getBlockTimestamp() + 1);
        IReactive.LogRecord memory transfer = _paymentLog(950, 1e6);
        transfer.topic_1 = uint160(OWNER);
        transfer.topic_2 = uint160(RECIPIENT);
        vm.prank(address(system));
        agent.react(transfer);
        assertEq(system.requestCount(), 3, "wallet activity gets a separate cancellation callback");
        _deliverRequest(2);
        assertEq(vault.payoutReadyAt(WORKFLOW), 0);
        vm.warp(readyAt);
        assertEq(_deliver(_run(108, P.SCHEDULE, 0)), vault.SKIPPED());
        assertEq(usdc.balanceOf(RECIPIENT), 0);
    }

    function testTransferWithSubjectRejectsSelfTransfers() public {
        P.Program memory prog =
            _program(P.TRANSFER, _branch(P.AMOUNT_ABOVE, 1e6, _action(P.ALERT, 0, address(0))));
        prog.source = address(usdc);
        prog.subject = OWNER;
        _enable(prog);

        IReactive.LogRecord memory selfTx = _paymentLog(951, 10e6);
        selfTx._contract = address(usdc);
        selfTx.topic_1 = uint160(OWNER);
        selfTx.topic_2 = uint160(OWNER);
        vm.prank(address(system));
        agent.react(selfTx);
        assertEq(system.requestCount(), 0, "self-transfer with subject != 0 rejected");

        IReactive.LogRecord memory outTx = _paymentLog(952, 10e6);
        outTx._contract = address(usdc);
        outTx.topic_1 = uint160(OWNER);
        outTx.topic_2 = uint160(RECIPIENT);
        vm.prank(address(system));
        agent.react(outTx);
        assertEq(system.requestCount(), 1);
    }

    function testEnableRejectsAlreadyExpiredAndZeroOracleGuardsExtremeSpot() public {
        P.Program memory expiredProg = _program(P.SCHEDULE, _path(_action(P.ALERT, 0, address(0))));
        expiredProg.expires = uint64(block.timestamp + 10);
        bytes memory encoded = abi.encode(expiredProg);
        bytes32 expId = keccak256("already expired");
        vm.startPrank(OWNER);
        vault.authorize(expId, 1, encoded, "Expired");
        vm.warp(block.timestamp + 10);
        vm.expectRevert(WorkflowAgentStorageV2.InvalidWorkflow.selector);
        agent.enable(expId, 1, encoded, "Expired", uint64(block.number));
        vm.expectRevert(WorkflowAgentStorageV2.InvalidWorkflow.selector);
        agent.enableWithBudget(
            expId,
            1,
            encoded,
            "Expired",
            uint64(block.number),
            WorkflowAgentStorageV2.BudgetSeed(0, 0, 0, 0, 0, 0)
        );
        vm.stopPrank();

        // Zero-oracle testnet cleanly rejects extreme reserve ratio spot > uint128.max with InvalidMarket.
        _enable(_program(P.SCHEDULE, _branch(P.DIP_BY, 500, _action(P.BUY, 1e6, address(0)))));
        pair.setReserves(type(uint112).max, 1);
        P.Run memory run = _run(960, P.SCHEDULE, 0);
        bytes32 expectedRunId = keccak256(
            abi.encode(address(agent), WORKFLOW, LASNA, bytes32(uint256(960)), uint64(0))
        );
        vm.expectEmit(true, true, false, true, address(vault));
        emit WorkflowVaultV2.Outcome(
            WORKFLOW,
            expectedRunId,
            1,
            vault.FAILED(),
            type(uint8).max,
            WorkflowProtocolsV2.InvalidMarket.selector
        );
        assertEq(_deliver(run), vault.FAILED());
    }

    function testGradualMultiSwapDipConfirmsOnSameChainCronWithoutSyncSubscription() public {
        P.Program memory prog =
            _program(P.SCHEDULE, _branch(P.DIP_BY, 500, _action(P.BUY, 1e6, address(0))));
        _enable(prog);
        usdc.mint(address(vault), 2e6);

        assertFalse(
            system.isSubscribed(
                P.UNICHAIN_SEPOLIA,
                ChainConfig.unichainSepolia().pair,
                uint256(keccak256("Sync(uint112,uint112)"))
            ),
            "same-chain DIP_BY does not subscribe to Sync"
        );

        _price(2_000_000);
        _cron(1);
        assertEq(system.requestCount(), 1);
        _deliverRequest(0);
        assertEq(router.swapCount(), 0);

        // 10 consecutive -0.6% swaps cumulating to -5.85% dip (~$1,883): next Cron triggers buy.
        uint112 spot = 2_000_000;
        for (uint256 i; i < 10; ++i) {
            spot = uint112((uint256(spot) * 9_940) / 10_000);
            _price(spot);
        }
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        _cron(2);
        assertEq(system.requestCount(), 2);
        _deliverRequest(1);
        assertEq(router.swapCount(), 1);
    }

    function _forwardReferenceSynced(uint256 blockNum) private {
        uint256 refSig = uint256(keccak256("ReferenceSynced(bytes32,uint64,uint128)"));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 index; index < logs.length; ++index) {
            if (logs[index].emitter != address(vault) || logs[index].topics[0] != bytes32(refSig)) {
                continue;
            }
            IReactive.LogRecord memory log;
            log.chain_id = P.UNICHAIN_SEPOLIA;
            log._contract = address(vault);
            log.topic_0 = refSig;
            log.topic_1 = uint256(logs[index].topics[1]);
            log.topic_2 = uint256(logs[index].topics[2]);
            log.data = logs[index].data;
            log.block_number = blockNum;
            log.tx_hash = blockNum + index;
            log.log_index = index;
            vm.prank(address(system));
            agent.react(log);
        }
    }

    function _slice(bytes memory data, uint256 start) private pure returns (bytes memory result) {
        result = new bytes(data.length - start);
        for (uint256 i; i < result.length; ++i) {
            result[i] = data[start + i];
        }
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

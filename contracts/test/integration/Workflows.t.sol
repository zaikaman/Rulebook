// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {CallbackConfiguration, IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {IWorkflowExecutor, WorkflowAgent} from "../../src/workflow/WorkflowAgent.sol";
import {WorkflowVault} from "../../src/workflow/WorkflowVault.sol";
import {WorkflowVaultFactory} from "../../src/workflow/WorkflowVaultFactory.sol";
import {WorkflowDirectory} from "../../src/workflow/WorkflowDirectory.sol";
import {WorkflowProgram as WF} from "../../src/workflow/WorkflowProgram.sol";
import {MockCallbackProxy} from "../mocks/MockCallbackProxy.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract WorkflowGasSystem is IReactiveSystem {
    uint256 public requests;
    event Requested(
        uint256 indexed chainId, address indexed recipient, uint64 gasLimit, bytes payload
    );

    function requestCallbackV_1_0(CallbackConfiguration calldata config) external {
        ++requests;
        emit Requested(config.chainId, config.recipient, config.gasLimit, config.payload);
    }

    function subscribe(uint256, address, uint256, uint256, uint256, uint256) external {}
    function unsubscribe(uint256, address, uint256, uint256, uint256, uint256) external {}
}

contract WorkflowsTest is Test {
    bytes32 private constant ID = keccak256("payment");
    bytes32 private constant OTHER = keccak256("other");
    address private constant SAVINGS = address(0x100);
    address private constant SECOND = address(0x200);

    MockSystemContract private system;
    WorkflowDirectory private directory;
    WorkflowVaultFactory private factory;
    WorkflowAgent private agent;
    WorkflowVault private vault;
    MockCallbackProxy private proxy;
    ChainConfig.Config private cfg;
    MockERC20 private usdc;

    function setUp() public {
        vm.roll(100);
        vm.warp(1_800_000_000);
        cfg = ChainConfig.unichainSepolia();
        system = new MockSystemContract();
        proxy = new MockCallbackProxy();
        directory = new WorkflowDirectory(system);
        factory = new WorkflowVaultFactory(address(proxy));
        agent = WorkflowAgent(payable(directory.create()));
        vault = WorkflowVault(payable(factory.create(address(agent))));
        agent.linkVault(address(vault));
        vm.etch(cfg.usdc, address(new MockERC20("Test USDC", "USDC", 6)).code);
        vm.etch(cfg.weth, address(new MockERC20("Test WETH", "WETH", 18)).code);
        usdc = MockERC20(cfg.usdc);
    }

    function testPaymentBranchesAndDuplicateDelivery() public {
        _enable(ID, 1, _payment());
        _paymentLog(120e4, 1);
        _paymentLog(60e4, 2);
        _paymentLog(10e4, 3);
        _paymentLog(120e4, 1);
        assertEq(system.requestCount(), 2);
        _deliver(0);
        _deliver(0);
        _deliver(1);
        assertEq(usdc.balanceOf(SAVINGS), 24e4);
        assertEq(usdc.balanceOf(SECOND), 3e4);
        uint256 remainder = usdc.balanceOf(address(vault));
        vault.withdraw(cfg.usdc, remainder);
        assertEq(usdc.balanceOf(address(this)), remainder);
    }

    function testPauseBlocksInflightAndResumeUsesNewEpoch() public {
        bytes memory program = _payment();
        _enable(ID, 1, program);
        _paymentLog(1e6, 1);
        vault.revoke(ID, 1, false);
        _deliver(0);
        agent.disable(ID, 1, false);
        _enable(ID, 2, program);
        _deliver(0);
        assertEq(usdc.balanceOf(SAVINGS), 0);
        _paymentLog(1e6, 2);
        _deliver(1);
        assertEq(usdc.balanceOf(SAVINGS), 2e5);
    }

    function testOnlyOneActivePaymentAndNoForgedCallback() public {
        bytes memory program = _payment();
        _enable(ID, 1, program);
        vm.expectRevert(WorkflowVault.InvalidAuthorization.selector);
        vault.authorize(OTHER, 1, program);
        _paymentLog(1e6, 1);
        bytes memory payload = _payload(0);
        (bool valid, bytes memory data) = address(vault).call(payload);
        assertFalse(valid);
        assertEq(bytes4(data), WorkflowVault.Unauthorized.selector);
    }

    function testLaterFailureRollsBackEarlierTransfer() public {
        WF.Action[] memory actions = new WF.Action[](2);
        actions[0] = WF.Action(1, 0, 1e6, SAVINGS);
        actions[1] = WF.Action(1, 0, 1e6, SECOND);
        _enable(ID, 1, _program(2, 1 hours, false, actions));
        usdc.mint(address(vault), 1e6);
        _cron(101, bytes32(uint256(1)));
        vm.recordLogs();
        _deliver(0);
        assertEq(usdc.balanceOf(SAVINGS), 0);
        assertEq(usdc.balanceOf(address(vault)), 1e6);
        _assertOutcome(false);
    }

    function testScheduleCoalescesAndAvoidsReplay() public {
        _enable(ID, 1, _program(2, 1 hours, false, _alert()));
        _cron(101, bytes32(uint256(1)));
        _cron(102, bytes32(uint256(2)));
        vm.warp(block.timestamp + 5 hours);
        _cron(103, bytes32(uint256(3)));
        _cron(104, bytes32(uint256(4)));
        assertEq(system.requestCount(), 2);
        vm.recordLogs();
        _deliver(1);
        _assertOutcome(true);
    }

    function testPriceNeedsBaselineAndRechecksBeforeSettlement() public {
        MockPair pair = new MockPair(cfg.usdc, cfg.weth);
        vm.etch(cfg.pair, address(pair).code);
        _enable(ID, 1, _program(3, 2e18, true, _alert()));
        _sync(1e6, 1 ether, 1);
        assertEq(system.requestCount(), 0);
        _sync(3e6, 1 ether, 2);
        assertEq(system.requestCount(), 1);
        MockPair(cfg.pair).setReserves(1e6, 1 ether);
        vm.recordLogs();
        _deliver(0);
        _assertOutcome(false);
    }

    function testMaximumDepthAndOrderedTransferSwapAlert() public {
        MockRouter router = new MockRouter();
        vm.etch(cfg.router, address(router).code);
        MockRouter(cfg.router).setPair(cfg.pair);
        MockPair pair = new MockPair(cfg.usdc, cfg.weth);
        vm.etch(cfg.pair, address(pair).code);
        MockPair(cfg.pair).setReserves(1_000e6, 100 ether);
        MockERC20(cfg.weth).mint(cfg.router, 10 ether);
        WF.Action[] memory actions = new WF.Action[](3);
        actions[0] = WF.Action(1, 1, 2_000, SAVINGS);
        actions[1] = WF.Action(2, 1, 2_000, address(0));
        actions[2] = WF.Action(3, 0, 0, address(0));
        WF.Node[] memory nodes = new WF.Node[](15);
        for (uint8 i; i < 7; ++i) {
            nodes[i] = WF.Node(1e6, 2 * i + 1, 2 * i + 2, new WF.Action[](0));
        }
        for (uint8 i = 7; i < 15; ++i) {
            nodes[i] = WF.Node(0, 0, 0, actions);
        }
        _enable(ID, 1, abi.encode(WF.Program(1, 1, 0, false, 10e6, 50, nodes)));
        _paymentLog(2e6, 1);
        vm.recordLogs();
        uint256 start = gasleft();
        _deliver(0);
        assertLt(start - gasleft(), 800_000);
        _assertOutcome(true);
        assertEq(usdc.balanceOf(SAVINGS), 4e5);
        assertGt(MockERC20(cfg.weth).balanceOf(address(vault)), 0);
    }

    function testFreeCopyAcceptsPersonalizationAndPublishesExactVersion() public {
        bytes memory program = _payment();
        _enable(ID, 1, program);
        uint256 listing = directory.publish(ID, "Payment", "Set aside part of each payment.");
        (,,, bytes32 hash,, bool visible) = directory.listings(listing);
        assertEq(hash, keccak256(program));
        assertTrue(visible);
        vm.startPrank(SECOND);
        WorkflowAgent copy = WorkflowAgent(payable(directory.create()));
        copy.linkVault(factory.create(address(copy)));
        WF.Program memory draft = WF.decode(program);
        draft.nodes[1].actions[0].recipient = SECOND;
        copy.enable(OTHER, 1, 100, abi.encode(draft), listing, "My payments");
        vm.stopPrank();
        assertTrue(directory.copied(listing, SECOND));
        directory.unpublish(listing);
        (,,,,, visible) = directory.listings(listing);
        assertFalse(visible);
    }

    function testFourMaximumPricePathsRespondWithinReactiveGasBudget() public {
        WorkflowGasSystem lightweight = new WorkflowGasSystem();
        WorkflowDirectory alternative = new WorkflowDirectory(lightweight);
        WorkflowAgent priceAgent = WorkflowAgent(payable(alternative.create()));
        priceAgent.linkVault(address(vault));
        WF.Action[] memory actions = new WF.Action[](3);
        actions[0] = WF.Action(1, 0, 1e5, SAVINGS);
        actions[1] = WF.Action(2, 0, 1e5, address(0));
        actions[2] = WF.Action(3, 0, 0, address(0));
        WF.Node[] memory nodes = new WF.Node[](15);
        for (uint8 i; i < 7; ++i) {
            nodes[i] = WF.Node(2e18, 2 * i + 1, 2 * i + 2, new WF.Action[](0));
        }
        for (uint8 i = 7; i < 15; ++i) {
            nodes[i] = WF.Node(0, 0, 0, actions);
        }
        for (uint128 i = 1; i <= 4; ++i) {
            bytes memory program = abi.encode(WF.Program(1, 3, 2e18 + i, true, 2e5, 50, nodes));
            priceAgent.enable(
                bytes32(uint256(i)), 1, uint64(block.number), program, 0, "Price workflow"
            );
        }
        IReactive.LogRecord memory log;
        log.chain_id = cfg.chainId;
        log._contract = cfg.pair;
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        log.data = abi.encode(uint112(1e6), uint112(1 ether));
        log.block_number = block.number + 1;
        log.tx_hash = 1;
        vm.prank(address(lightweight));
        priceAgent.react(log);

        log.data = abi.encode(uint112(3e6), uint112(1 ether));
        log.log_index = 1;
        vm.prank(address(lightweight));
        priceAgent.react{gas: 750_000}(log);
        assertEq(lightweight.requests(), 4);
    }

    function _enable(bytes32 id, uint64 epoch, bytes memory program) private {
        vault.authorize(id, epoch, program);
        agent.enable(id, epoch, uint64(block.number), program, 0, "Workflow");
    }

    function _payment() private pure returns (bytes memory) {
        WF.Node[] memory nodes = new WF.Node[](5);
        nodes[0] = WF.Node(1e6, 1, 2, new WF.Action[](0));
        nodes[2] = WF.Node(25e4, 3, 4, new WF.Action[](0));
        nodes[4] = WF.Node(0, 0, 0, new WF.Action[](0));
        WF.Action[] memory actions = new WF.Action[](2);
        actions[0] = WF.Action(1, 1, 2_000, SAVINGS);
        actions[1] = WF.Action(3, 0, 0, address(0));
        nodes[1] = WF.Node(0, 0, 0, actions);
        actions = new WF.Action[](2);
        actions[0] = WF.Action(1, 1, 500, SECOND);
        actions[1] = WF.Action(3, 0, 0, address(0));
        nodes[3] = WF.Node(0, 0, 0, actions);
        return abi.encode(WF.Program(1, 1, 0, false, 2e6, 50, nodes));
    }

    function _program(uint8 trigger, uint128 target, bool rising, WF.Action[] memory actions)
        private
        pure
        returns (bytes memory)
    {
        WF.Node[] memory nodes = new WF.Node[](1);
        nodes[0] = WF.Node(0, 0, 0, actions);
        return abi.encode(WF.Program(1, trigger, target, rising, 2e6, 50, nodes));
    }

    function _alert() private pure returns (WF.Action[] memory actions) {
        actions = new WF.Action[](1);
        actions[0] = WF.Action(3, 0, 0, address(0));
    }

    function _paymentLog(uint256 amount, uint256 index) private {
        usdc.mint(address(vault), amount);
        IReactive.LogRecord memory log;
        log.chain_id = cfg.chainId;
        log._contract = cfg.usdc;
        log.topic_0 = uint256(keccak256("Transfer(address,address,uint256)"));
        log.topic_1 = uint160(SAVINGS);
        log.topic_2 = uint160(address(vault));
        log.data = abi.encode(amount);
        log.block_number = block.number + 1;
        log.tx_hash = 10;
        log.log_index = index;
        vm.prank(address(system));
        agent.react(log);
    }

    function _sync(uint112 first, uint112 second, uint256 index) private {
        IReactive.LogRecord memory log;
        log.chain_id = cfg.chainId;
        log._contract = cfg.pair;
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        log.data = abi.encode(first, second);
        log.block_number = block.number + 1;
        log.tx_hash = 11;
        log.log_index = index;
        vm.prank(address(system));
        agent.react(log);
    }

    function _cron(uint256 number, bytes32 txHash) private {
        IReactive.LogRecord memory log;
        log.chain_id = ChainConfig.LASNA;
        log._contract = ChainConfig.lasna().cronSource;
        log.topic_0 = uint256(keccak256("Cron100(uint256)"));
        log.topic_1 = number;
        log.block_number = number;
        log.tx_hash = uint256(txHash);
        vm.prank(address(system));
        agent.react(log);
    }

    function _payload(uint256 index) private view returns (bytes memory payload) {
        CallbackConfiguration memory callback = system.requestAt(index);
        assertEq(callback.recipient, address(vault));
        assertEq(callback.chainId, cfg.chainId);
        payload = callback.payload;
        address sender = address(agent);
        assembly {
            mstore(add(payload, 36), sender)
        }
        assertEq(bytes4(payload), IWorkflowExecutor.executeWorkflow.selector);
    }

    function _deliver(uint256 index) private {
        bytes memory payload = _payload(index);
        vm.prank(address(proxy));
        (bool ok,) = address(vault).call{gas: 850_000}(payload);
        assertTrue(ok);
    }

    function _assertOutcome(bool completed) private view {
        // Match the real terminal event. A successful wrapper receipt can report rolled-back steps.
        bytes32 outcome =
            keccak256("WorkflowOutcome(bytes32,bytes32,bytes32,uint64,uint8,bool,bytes4)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 matches;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(vault) || logs[i].topics[0] != outcome) continue;
            (,, bool status,) = abi.decode(logs[i].data, (uint64, uint8, bool, bytes4));
            assertEq(status, completed);
            ++matches;
        }
        assertEq(matches, 1);
    }
}


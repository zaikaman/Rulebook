// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {IRuleRegistry} from "../../src/registry/IRuleRegistry.sol";
import {CallbackConfiguration} from "../../src/shared/ReactiveTypes.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {MirrorVault} from "../../src/vault/MirrorVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract MirrorLoopTest is Test {
    address internal constant PROXY = address(0x1234);
    address internal constant LEADER = address(0x1101);
    address internal constant FOLLOWER = address(0x1102);
    bytes32 internal constant LEADER_TX = bytes32(uint256(2));

    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    MockPair internal pair;
    MockRouter internal router;
    MockSystemContract internal system;
    Agent internal leader;
    Agent internal follower;
    Vault internal leaderVault;
    Vault internal followerVault;

    function setUp() public {
        system = new MockSystemContract();
        AgentFactory factory = new AgentFactory(system, IRuleRegistry(address(0)));
        leader = Agent(factory.deploy(LEADER));
        follower = Agent(factory.deploy(FOLLOWER));
        tokenIn = new MockERC20("USD", "USD", 6);
        tokenOut = new MockERC20("Token", "TOK", 18);
        pair = new MockPair(address(tokenIn), address(tokenOut));
        pair.setReserves(1000e6, 1000e18);
        router = new MockRouter();
        router.setPair(address(pair));
        tokenOut.mint(address(router), 20e18);
        leaderVault = new Vault(
            IPayable(payable(PROXY)),
            LEADER,
            address(leader),
            address(router),
            address(tokenIn),
            address(tokenOut),
            100e6,
            false
        );
        followerVault = new MirrorVault(
            IPayable(payable(PROXY)),
            FOLLOWER,
            address(follower),
            address(router),
            address(tokenIn),
            address(tokenOut),
            100e6
        );
        _fund(leaderVault);
        _fund(followerVault);

        vm.startPrank(LEADER);
        leader.linkVault(1301, address(leaderVault));
        leader.addRule(
            RuleLib.Rule(
                3,
                1301,
                0,
                address(pair),
                address(tokenIn),
                address(tokenOut),
                2e6,
                1e30,
                block.timestamp + 1 days,
                0,
                0
            ),
            false
        );
        vm.stopPrank();
        vm.startPrank(FOLLOWER);
        follower.linkVault(1301, address(followerVault));
        follower.addMirror(
            0,
            Agent.MirrorConfig(
                1301, address(leaderVault), 0, 5_000, 800_000, 1, address(leader), address(tokenIn)
            )
        );
        vm.stopPrank();
    }

    function test_leaderAndFollowerTradeOnceUsingIndependentPrincipal() public {
        IReactive.LogRecord memory origin;
        origin.chain_id = 1301;
        origin._contract = address(pair);
        origin.topic_0 = uint256(MockPair.Sync.selector);
        origin.data = abi.encode(uint112(1000e6), uint112(1000e18));
        origin.tx_hash = 1;
        vm.prank(address(system));
        leader.react(origin);
        assertEq(system.requestCount(), 1);

        vm.recordLogs();
        _deliver(0, leader, leaderVault);
        Vm.Log[] memory events = vm.getRecordedLogs();
        IReactive.LogRecord memory executed;
        for (uint256 i; i < events.length; ++i) {
            if (events[i].emitter != address(leaderVault)) continue;
            if (events[i].topics[0] != Vault.Executed.selector) continue;
            executed.chain_id = 1301;
            executed._contract = address(leaderVault);
            executed.topic_0 = uint256(events[i].topics[0]);
            executed.topic_1 = uint256(events[i].topics[1]);
            executed.data = events[i].data;
            executed.tx_hash = uint256(LEADER_TX);
        }
        assertEq(executed.topic_0, uint256(Vault.Executed.selector));
        vm.prank(address(system));
        follower.react(executed);
        assertEq(system.requestCount(), 2);

        vm.expectEmit(true, true, false, true, address(followerVault));
        emit Vault.Mirrored(0, address(leaderVault), LEADER_TX);
        _deliver(1, follower, followerVault);
        assertEq(leaderVault.principalOf(address(tokenIn)), 18e6);
        assertEq(followerVault.principalOf(address(tokenIn)), 19_200_000);
        assertEq(router.swapCount(), 2);

        vm.prank(address(system));
        follower.react(executed);
        assertEq(system.requestCount(), 2);
        assertEq(router.swapCount(), 2);

        Agent third = Agent(AgentFactory(follower.factory()).deploy(address(this)));
        third.linkVault(1301, address(0x100));
        vm.expectRevert(bytes4(keccak256("MirrorDepthNotAllowed()")));
        third.addMirror(
            0,
            Agent.MirrorConfig(
                1301,
                address(followerVault),
                0,
                5_000,
                800_000,
                1,
                address(follower),
                address(tokenIn)
            )
        );
    }

    function _fund(Vault vault) private {
        tokenIn.mint(address(this), 20e6);
        tokenIn.approve(address(vault), 20e6);
        vault.deposit(address(tokenIn), 20e6);
    }

    function _deliver(uint256 index, Agent sender, Vault destination) private {
        CallbackConfiguration memory request = system.requestAt(index);
        assertEq(request.recipient, address(destination));
        bytes memory payload = request.payload;
        assembly ("memory-safe") {
            mstore(add(payload, 36), sender)
        }
        vm.prank(PROXY);
        (bool ok,) = request.recipient.call(payload);
        assertTrue(ok, "callback reverted");
    }
}

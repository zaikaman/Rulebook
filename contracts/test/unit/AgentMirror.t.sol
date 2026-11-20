// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {Subscription} from "../../src/agent/AgentRulePolicy.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {IRuleRegistry} from "../../src/registry/IRuleRegistry.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {
    ExceedsPerRunCap,
    InvalidAmount,
    InvalidSecondary,
    InvalidTemplateParams,
    MirrorDepthNotAllowed,
    NotOwner,
    RuleLimitReached,
    RuleNotActive,
    TokenMismatch
} from "../../src/shared/Errors.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract AgentMirrorTest is Test {
    address internal constant LEADER_OWNER = address(0x1101);
    address internal constant FOLLOWER_OWNER = address(0x1102);
    address internal constant LEADER_VAULT = address(0x1103);
    address internal constant FOLLOWER_VAULT = address(0x1104);
    address internal constant TOKEN_IN = address(0x1105);
    address internal constant TOKEN_OUT = address(0x1106);
    address internal constant PAIR = address(0x1107);

    Agent internal leader;
    Agent internal follower;
    MockSystemContract internal system;

    function setUp() public {
        vm.warp(10 days);
        system = new MockSystemContract();
        AgentFactory factory = new AgentFactory(system, IRuleRegistry(address(0)));
        leader = Agent(factory.deploy(LEADER_OWNER));
        follower = Agent(factory.deploy(FOLLOWER_OWNER));
        vm.startPrank(LEADER_OWNER);
        leader.linkVault(1301, LEADER_VAULT);
        leader.addRule(
            RuleLib.Rule(3, 1301, 0, PAIR, TOKEN_IN, TOKEN_OUT, 12e6, 1e18, 11 days, 0, 0), false
        );
        vm.stopPrank();
        vm.prank(FOLLOWER_OWNER);
        follower.linkVault(1301, FOLLOWER_VAULT);
    }

    function test_rejectsSelfAndMismatchedInputToken() public {
        Agent.MirrorConfig memory config = _config();
        config.leaderAgent = address(follower);
        vm.prank(FOLLOWER_OWNER);
        vm.expectRevert(MirrorDepthNotAllowed.selector);
        follower.addMirror(0, config);
        config.leaderAgent = address(leader);
        config.tokenIn = TOKEN_OUT;
        vm.prank(FOLLOWER_OWNER);
        vm.expectRevert(abi.encodeWithSelector(TokenMismatch.selector, TOKEN_IN, TOKEN_OUT));
        follower.addMirror(0, config);
    }

    function test_rejectsScaleAndHourlyCapOutsideBounds() public {
        Agent.MirrorConfig memory config = _config();
        config.scaleBps = 10_001;
        _rejectSecondary(config);
        config.scaleBps = 5_000;
        config.hourlyCap = 0;
        _rejectSecondary(config);
        config.hourlyCap = 11;
        _rejectSecondary(config);
    }

    function test_onlyTheFollowerOwnerCanAttachOrDetach() public {
        vm.expectRevert(NotOwner.selector);
        follower.addMirror(0, _config());
        _attach();
        vm.expectRevert(NotOwner.selector);
        follower.detachMirror(0);
    }

    function test_rejectsMissingWrongOrInactiveSource() public {
        Agent.MirrorConfig memory config = _config();
        config.leaderChainId = 1;
        _reject(0, InvalidTemplateParams.selector, config);
        config = _config();
        config.leaderVault = address(0);
        _reject(0, InvalidTemplateParams.selector, config);
        config.leaderVault = address(0xDEAD);
        _reject(0, InvalidTemplateParams.selector, config);
        config = _config();
        vm.prank(LEADER_OWNER);
        leader.pauseRule(0);
        _reject(0, InvalidTemplateParams.selector, config);
    }

    function test_rejectsAnAgentOutsideTheFactory() public {
        Agent impostor =
            new Agent(address(this), system, IRuleRegistry(address(0)), follower.factory());
        Agent.MirrorConfig memory config = _config();
        config.leaderAgent = address(impostor);
        _reject(0, MirrorDepthNotAllowed.selector, config);
    }

    function test_checksRuleIdCapAndUniqueActiveAttachment() public {
        Agent.MirrorConfig memory config = _config();
        _reject(1, RuleNotActive.selector, config);
        config.perRunCap = 0;
        _reject(0, InvalidAmount.selector, config);
        config.perRunCap = follower.MAX_SPEND_PER_RUN() + 1;
        _reject(0, ExceedsPerRunCap.selector, config);
        _attach();
        _reject(1, InvalidTemplateParams.selector, _config());
        vm.prank(FOLLOWER_OWNER);
        vm.expectPartialRevert(RuleNotActive.selector);
        follower.detachMirror(1);
    }

    function test_fullAccountRejectsAttachAndResume() public {
        _attach();
        vm.startPrank(FOLLOWER_OWNER);
        follower.pauseRule(0);
        RuleLib.Rule memory alert =
            RuleLib.Rule(11, 1301, 0, PAIR, TOKEN_IN, TOKEN_OUT, 0, 1e18, 0, 0, 0);
        for (uint256 i; i < 5; ++i) {
            follower.addRule(alert, false);
        }
        vm.expectPartialRevert(RuleLimitReached.selector);
        follower.resumeRule(0);
        vm.stopPrank();
        _reject(6, RuleLimitReached.selector, _config());
    }

    function test_refusesOtherExecutionsOrThoseThatRoundToZero() public {
        _attach();
        IReactive.LogRecord memory log = _log(1);
        log.topic_1 = 1;
        _deliver(log);
        log.topic_1 = 0;
        log.data = abi.encode(TOKEN_OUT, TOKEN_IN, 12e6, 12e18, uint256(1));
        _deliver(log);
        log.data = abi.encode(TOKEN_IN, TOKEN_OUT, uint256(1), uint256(1), uint256(1));
        _deliver(log);
        assertEq(system.requestCount(), 0);
    }

    function test_subscribesOnlyToExecutedAndIgnoresWrongTopic() public {
        _attach();
        assertEq(system.lastSubscribedTopic(), uint256(Vault.Executed.selector));
        Subscription[3] memory subscriptions = follower.getSubscriptions(0);
        assertEq(subscriptions[0].source, LEADER_VAULT);
        assertEq(subscriptions[1].key, bytes32(0));
        IReactive.LogRecord memory log = _log(1);
        log.topic_0 = uint256(Vault.Mirrored.selector);
        _deliver(log);
        assertEq(system.requestCount(), 0);
    }

    function test_replayAndBurstCannotRequestExtraCallbacks() public {
        _attach();
        _deliver(_log(1));
        _deliver(_log(1));
        _deliver(_log(2));
        assertEq(system.requestCount(), 1);
        assertEq(system.requestAt(0).recipient, FOLLOWER_VAULT);
        assertEq(system.requestAt(0).gasLimit, follower.MIRROR_CALLBACK_GAS());
        assertEq(follower.getRule(0).runs, 1);
        vm.warp(block.timestamp + 1 hours);
        _deliver(_log(1));
        _deliver(_log(3));
        assertEq(system.requestCount(), 2);
    }

    function test_pauseResumeAndDetachControlSubscriptions() public {
        _attach();
        assertFalse(follower.budgetIsLow());
        uint256 initial = system.unsubscribeCount();
        vm.prank(FOLLOWER_OWNER);
        follower.pauseRule(0);
        _deliver(_log(1));
        assertEq(system.requestCount(), 0);
        assertEq(system.unsubscribeCount(), initial + 1);
        vm.prank(FOLLOWER_OWNER);
        follower.resumeRule(0);
        _deliver(_log(1));
        assertEq(system.requestCount(), 1);
        vm.prank(FOLLOWER_OWNER);
        follower.detachMirror(0);
        _deliver(_log(2));
        assertEq(system.requestCount(), 1);
        assertEq(follower.getMirror(0).leaderVault, address(0));
    }

    function _attach() private {
        vm.prank(FOLLOWER_OWNER);
        follower.addMirror(0, _config());
    }

    function _rejectSecondary(Agent.MirrorConfig memory config) private {
        _reject(0, InvalidSecondary.selector, config);
    }

    function _reject(uint256 ruleId, bytes4 selector, Agent.MirrorConfig memory config) private {
        vm.prank(FOLLOWER_OWNER);
        vm.expectPartialRevert(selector);
        follower.addMirror(ruleId, config);
    }

    function _config() private view returns (Agent.MirrorConfig memory) {
        return Agent.MirrorConfig(1301, LEADER_VAULT, 0, 5_000, 5e6, 1, address(leader), TOKEN_IN);
    }

    function _log(uint256 txHash) private pure returns (IReactive.LogRecord memory log) {
        log.chain_id = 1301;
        log._contract = LEADER_VAULT;
        log.topic_0 = uint256(Vault.Executed.selector);
        log.tx_hash = txHash;
        log.data = abi.encode(TOKEN_IN, TOKEN_OUT, 12e6, 12e18, uint256(1));
    }

    function _deliver(IReactive.LogRecord memory log) private {
        vm.prank(address(system));
        follower.react(log);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {
    InvalidSecondary,
    InvalidTemplateParams,
    NotOwner,
    NotServiceProvider,
    RuleLimitReached,
    RuleNotActive
} from "../../src/shared/Errors.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract AgentTest is Test {
    address internal constant USER = address(0xA11CE);
    address internal constant STRANGER = address(0xB0B);

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
        agent = new Agent(USER, IReactiveSystem(address(system)), address(this));
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 1;
        rule.chainId = 1301;
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.tokenOut = address(weth);
        rule.amountIn = 10e6;
    }

    function _addRule() internal returns (uint256 ruleId) {
        vm.prank(USER);
        ruleId = agent.addRule(_rule(), false);
    }

    function test_reactRejectsNonSystemCaller() public {
        IReactive.LogRecord memory log;
        vm.expectRevert(NotServiceProvider.selector);
        agent.react(log);
    }

    function test_addRuleRejectsNonOwner() public {
        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        agent.addRule(_rule(), false);
    }

    function test_addRuleStopsAtFiveActiveRules() public {
        for (uint256 i = 0; i < 5; ++i) {
            _addRule();
        }
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(RuleLimitReached.selector, 5, 5));
        agent.addRule(_rule(), false);
    }

    function test_addRuleEmitsRuleCreatedWithTemplate() public {
        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RuleCreated(address(agent), 0, 1, false);
        _addRule();
    }

    function test_getRuleIdsReturnsEvaluationOrder() public {
        _addRule();
        _addRule();
        _addRule();
        uint256[] memory ids = agent.getRuleIds();
        assertEq(ids.length, 3);
        assertEq(ids[0], 0);
        assertEq(ids[2], 2);
    }

    function test_getRuleReturnsStoredParameters() public {
        uint256 ruleId = _addRule();
        RuleLib.Rule memory stored = agent.getRule(ruleId);
        assertEq(stored.template, 1);
        assertEq(stored.chainId, 1301);
        assertEq(stored.amountIn, 10e6);
        assertEq(stored.pair, address(pair));
    }

    function test_activeRuleCountTracksLifecycle() public {
        uint256 ruleId = _addRule();
        assertEq(agent.activeRuleCount(), 1);
        vm.startPrank(USER);
        agent.pauseRule(ruleId);
        assertEq(agent.activeRuleCount(), 0);
        agent.resumeRule(ruleId);
        assertEq(agent.activeRuleCount(), 1);
        agent.cancelRule(ruleId);
        assertEq(agent.activeRuleCount(), 0);
        vm.stopPrank();
    }

    function test_pauseReleasesTheLastSubscriptionOnce() public {
        uint256 ruleId = _addRule();
        assertEq(system.subscribeCount(), 1);
        vm.prank(USER);
        agent.pauseRule(ruleId);
        assertEq(system.unsubscribeCount(), 1);
    }

    function test_reorderRejectsUnknownId() public {
        _addRule();
        uint256[] memory ids = new uint256[](1);
        ids[0] = 99;
        vm.prank(USER);
        vm.expectRevert();
        agent.reorderRules(ids);
    }

    function test_linkVaultIsOwnerOnlyAndRecordsTheVault() public {
        vm.prank(USER);
        agent.linkVault(1301, address(0x1234));
        assertEq(agent.getVault(1301), address(0x1234));

        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        agent.linkVault(1301, address(0x5678));
    }

    function test_agentFactoryDeploysAndRefusesRedeploy() public {
        AgentFactory factory = new AgentFactory(IReactiveSystem(address(system)));
        address deployed = factory.deploy(USER);
        assertEq(factory.agentOf(USER), deployed);
        assertEq(Agent(deployed).owner(), USER);
        assertEq(factory.agentCount(), 1);
        assertEq(address(factory.systemContract()), address(system));

        vm.expectRevert();
        factory.deploy(USER);

        vm.expectRevert();
        factory.deploy(address(0));
    }

    function test_pauseRejectsInactiveRule() public {
        uint256 ruleId = _addRule();
        vm.startPrank(USER);
        agent.pauseRule(ruleId);
        vm.expectRevert(abi.encodeWithSelector(RuleNotActive.selector, ruleId));
        agent.pauseRule(ruleId);
        vm.stopPrank();
    }

    function test_resumeRejectsActiveRule() public {
        uint256 ruleId = _addRule();
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(RuleNotActive.selector, ruleId));
        agent.resumeRule(ruleId);
    }

    function test_resumeRejectsCancelledRule() public {
        uint256 ruleId = _addRule();
        vm.startPrank(USER);
        agent.cancelRule(ruleId);
        vm.expectRevert(abi.encodeWithSelector(RuleNotActive.selector, ruleId));
        agent.resumeRule(ruleId);
        vm.stopPrank();
    }

    function test_cancelReleasesSubscriptionsAndRejectsDoubleCancel() public {
        uint256 first = _addRule();
        uint256 second = _addRule();
        uint256 third = _addRule();
        vm.startPrank(USER);
        agent.pauseRule(third);
        agent.cancelRule(third);
        agent.cancelRule(second);
        agent.cancelRule(first);
        vm.stopPrank();

        assertEq(system.unsubscribeCount(), 1);
        assertEq(agent.activeRuleCount(), 0);

        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(RuleNotActive.selector, first));
        agent.cancelRule(first);
    }

    function test_resetRuleClearsLatchAndRejectsCancelledRule() public {
        uint256 ruleId = _addRule();
        vm.prank(USER);
        agent.resetRule(ruleId);

        vm.startPrank(USER);
        agent.cancelRule(ruleId);
        vm.expectRevert(abi.encodeWithSelector(RuleNotActive.selector, ruleId));
        agent.resetRule(ruleId);
        vm.stopPrank();
    }

    function test_reorderRulesPersistsAPermutation() public {
        _addRule();
        _addRule();
        _addRule();
        uint256[] memory ids = new uint256[](3);
        ids[0] = 2;
        ids[1] = 0;
        ids[2] = 1;
        vm.prank(USER);
        agent.reorderRules(ids);

        uint256[] memory ordered = agent.getRuleIds();
        assertEq(ordered[0], 2);
        assertEq(ordered[1], 0);
        assertEq(ordered[2], 1);
    }

    function test_reorderRejectsWrongLengthAndDuplicates() public {
        _addRule();
        uint256[] memory short = new uint256[](0);
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.reorderRules(short);

        _addRule();
        uint256[] memory duplicate = new uint256[](2);
        duplicate[0] = 0;
        duplicate[1] = 0;
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.reorderRules(duplicate);
    }

    function test_linkVaultValidatesArgumentsAndIsIdempotent() public {
        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.linkVault(999, address(0x1234));
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.linkVault(1301, address(0));

        agent.linkVault(1301, address(0x1234));
        agent.linkVault(1301, address(0x1234));
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.linkVault(1301, address(0x5678));
        vm.stopPrank();
    }

    function _mirrorConfig() internal pure returns (Agent.MirrorConfig memory) {
        return Agent.MirrorConfig({
            leaderChainId: 1301,
            leaderVault: address(0x4444),
            leaderRuleId: 7,
            scaleBps: 5_000,
            perRunCap: 5e6,
            hourlyCap: 3
        });
    }

    function test_addMirrorValidatesAndStoresConfig() public {
        uint256 ruleId = _addRule();
        Agent.MirrorConfig memory config = Agent.MirrorConfig({
            leaderChainId: 1301,
            leaderVault: address(0x4444),
            leaderRuleId: 7,
            scaleBps: 5_000,
            perRunCap: 5e6,
            hourlyCap: 3
        });

        vm.startPrank(USER);
        agent.addMirror(ruleId, config);
        assertEq(agent.getMirror(ruleId).leaderVault, address(0x4444));

        Agent.MirrorConfig memory bad = config;
        bad.leaderChainId = 999;
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.addMirror(ruleId, bad);

        bad = _mirrorConfig();
        bad.leaderVault = address(0);
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.addMirror(ruleId, bad);

        bad = _mirrorConfig();
        bad.scaleBps = 0;
        vm.expectRevert(InvalidSecondary.selector);
        agent.addMirror(ruleId, bad);

        bad = _mirrorConfig();
        bad.scaleBps = 10_001;
        vm.expectRevert(InvalidSecondary.selector);
        agent.addMirror(ruleId, bad);

        bad = _mirrorConfig();
        bad.hourlyCap = 0;
        vm.expectRevert(InvalidSecondary.selector);
        agent.addMirror(ruleId, bad);

        bad = _mirrorConfig();
        bad.hourlyCap = 11;
        vm.expectRevert(InvalidSecondary.selector);
        agent.addMirror(ruleId, bad);

        vm.expectRevert(abi.encodeWithSelector(RuleNotActive.selector, 99));
        agent.addMirror(99, config);
        vm.stopPrank();
    }

    function test_reactCachesLastTradedPriceFromSync() public {
        IReactive.LogRecord memory log;
        log.chain_id = 1301;
        log._contract = address(pair);
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        log.data = abi.encode(uint112(1_000), uint112(2_000));
        log.tx_hash = uint256(keccak256("tx"));
        log.log_index = 3;

        vm.prank(address(system));
        agent.react(log);

        (uint256 price, uint64 observedAt) = agent.getCachedPrice(address(pair));
        assertEq(price, 2e18);
        assertEq(observedAt, uint64(block.timestamp));
        assertEq(agent.getHighWater(0), 0);
    }

    function test_reactEmitsRuleEvaluatedForEveryRule() public {
        uint256 ruleId = _addRule();
        IReactive.LogRecord memory log;
        log.chain_id = 1301;
        log.tx_hash = uint256(keccak256("tx"));
        log.log_index = 5;

        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RuleEvaluated(ruleId, 1301, bytes32(uint256(keccak256("tx"))), 5, false);
        vm.prank(address(system));
        agent.react(log);
    }

    function test_addRuleRejectsAnUnknownTemplate() public {
        RuleLib.Rule memory rule = _rule();
        rule.template = 14;
        vm.prank(USER);
        vm.expectRevert();
        agent.addRule(rule, false);
    }
}

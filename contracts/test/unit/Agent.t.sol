// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {RuleRegistry} from "../../src/registry/RuleRegistry.sol";
import {IRuleRegistry} from "../../src/registry/IRuleRegistry.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {
    AgentNotLinked,
    ExceedsPerRunCap,
    InvalidSecondary,
    InvalidTemplateParams,
    NotOwner,
    NotServiceProvider,
    RegistryNotConfigured,
    RuleLimitReached,
    RuleNotActive,
    UnknownTemplate
} from "../../src/shared/Errors.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";
import {MockVaultLink} from "../mocks/MockVaultLink.sol";

contract AgentTest is Test {
    address internal constant USER = address(0xA11CE);
    address internal constant STRANGER = address(0xB0B);

    MockSystemContract internal system;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockPair internal pair;
    RuleRegistry internal registry;
    Agent internal agent;

    function setUp() public {
        system = new MockSystemContract();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pair = new MockPair(address(usdc), address(weth));
        registry = new RuleRegistry();
        agent = new Agent(USER, IReactiveSystem(address(system)), registry, address(this));
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

    function test_addRuleListsWhenPublic() public {
        vm.prank(USER);
        uint256 ruleId = agent.addRule(_rule(), true);

        RuleRegistry.Listing memory listing = registry.getListing(address(agent), ruleId);
        assertEq(listing.author, USER);
        assertEq(listing.template, 1);
        assertEq(listing.paramsHash, RuleLib.paramsHash(agent.getRule(ruleId)));
        assertTrue(listing.isPublic);
        assertTrue(registry.isListed(address(agent), ruleId));
    }

    function test_addRuleKeepsPrivateRulesOutOfTheRegistry() public {
        vm.prank(USER);
        uint256 ruleId = agent.addRule(_rule(), false);

        assertFalse(registry.isListed(address(agent), ruleId));
        assertEq(registry.listingCount(), 0);
    }

    function test_addRuleRevertsWhenTheRegistryIsMissing() public {
        Agent unlisted = new Agent(
            USER, IReactiveSystem(address(system)), IRuleRegistry(address(0)), address(this)
        );

        vm.prank(USER);
        vm.expectRevert(RegistryNotConfigured.selector);
        unlisted.addRule(_rule(), true);
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

    function test_cloneCannotBeInitializedAgainOrTransferItsOwner() public {
        AgentFactory factory = new AgentFactory(IReactiveSystem(address(system)), registry);
        Agent clone = Agent(factory.deploy(USER));
        vm.prank(address(factory));
        vm.expectRevert(InvalidTemplateParams.selector);
        clone.initialize(STRANGER);
        vm.prank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        clone.transferOwnership(STRANGER);
        assertEq(clone.owner(), USER);
    }

    function test_rejectsVaultEventRulesWithoutALink() public {
        RuleLib.Rule memory rule = _rule();
        rule.template = 9;
        rule.threshold = 1e6;
        vm.prank(USER);
        vm.expectRevert(AgentNotLinked.selector);
        agent.addRule(rule, false);
    }

    function test_refusesToCreateAnExpiredLimitBuy() public {
        vm.warp(10_000);
        RuleLib.Rule memory rule = _rule();
        rule.template = 3;
        rule.threshold = 1000e18;
        rule.secondary = 9_999;
        vm.prank(USER);
        vm.expectRevert(InvalidSecondary.selector);
        agent.addRule(rule, false);
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
        // Plain DCA only needs the scheduled tick. The vault quotes live at execution.
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
        MockVaultLink vault = new MockVaultLink(address(agent));
        MockVaultLink other = new MockVaultLink(address(agent));

        vm.prank(USER);
        agent.linkVault(1301, address(vault));
        assertEq(agent.getVault(1301), address(vault));

        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        agent.linkVault(1301, address(other));
    }

    function test_agentFactoryDeploysAndRefusesRedeploy() public {
        AgentFactory factory = new AgentFactory(IReactiveSystem(address(system)), registry);
        address deployed = factory.deploy(USER);
        assertEq(factory.agentOf(USER), deployed);
        assertEq(Agent(deployed).owner(), USER);
        assertEq(factory.agentCount(), 1);
        assertEq(address(factory.systemContract()), address(system));
        assertEq(address(factory.registry()), address(registry));

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
        assertEq(system.subscribeCount(), 1, "three rules share one clock");
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
        MockVaultLink other = new MockVaultLink(address(agent));
        MockVaultLink foreign = new MockVaultLink(address(0xDEAD));

        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.linkVault(999, address(foreign));
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.linkVault(1301, address(0));
        agent.linkVault(1301, address(foreign));
        agent.linkVault(1301, address(foreign));
        vm.expectRevert(abi.encodeWithSelector(InvalidTemplateParams.selector));
        agent.linkVault(1301, address(other));
        vm.stopPrank();
    }

    function test_reactCachesLastTradedPriceFromSync() public {
        IReactive.LogRecord memory log;
        log.chain_id = 1301;
        log._contract = address(pair);
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        log.data = abi.encode(uint112(2e6), uint112(1e18));
        log.tx_hash = uint256(keccak256("tx"));
        log.log_index = 3;

        vm.prank(address(system));
        agent.react(log);

        (uint256 price, uint64 observedAt) = agent.getCachedPrice(address(pair));
        assertEq(price, 2e18);
        assertEq(observedAt, uint64(block.timestamp));
        assertEq(agent.getHighWater(0), 0);
    }

    function test_ignoresMalformedAndEmptySyncBeforeFirstPrice() public {
        RuleLib.Rule memory rule = _rule();
        rule.template = 11;
        rule.amountIn = 0;
        rule.threshold = 1e18;
        vm.prank(USER);
        uint256 ruleId = agent.addRule(rule, false);

        IReactive.LogRecord memory log;
        log.chain_id = 1301;
        log._contract = address(pair);
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        vm.startPrank(address(system));
        agent.react(log);
        log.data = abi.encode(uint112(0), uint112(1));
        agent.react(log);
        vm.stopPrank();
        assertEq(agent.getRule(ruleId).runs, 0);
        assertEq(agent.previousPriceOf(address(pair)), 0);
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

    function _alertRule(uint256 threshold) internal view returns (RuleLib.Rule memory rule) {
        rule.template = 11;
        rule.chainId = 1301;
        rule.pair = address(pair);
        rule.threshold = threshold;
    }

    function _syncLog() internal view returns (IReactive.LogRecord memory log) {
        log.chain_id = 1301;
        log._contract = address(pair);
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        log.data = abi.encode(uint112(2e6), uint112(1e18));
        log.tx_hash = uint256(keccak256("origin-tx"));
        log.log_index = 9;
    }

    function test_reactEmitsFiredTrueForARuleWhoseConditionHolds() public {
        vm.prank(USER);
        uint256 ruleId = agent.addRule(_alertRule(1e18), false);
        IReactive.LogRecord memory log = _syncLog();

        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RuleEvaluated(ruleId, 1301, bytes32(uint256(keccak256("origin-tx"))), 9, true);
        vm.prank(address(system));
        agent.react(log);
    }

    function test_reactEmitsFiredFalseForARuleWhoseConditionDoesNotHold() public {
        vm.prank(USER);
        uint256 ruleId = agent.addRule(_alertRule(5e18), false);
        IReactive.LogRecord memory log = _syncLog();

        vm.expectEmit(true, true, false, true, address(agent));
        emit Agent.RuleEvaluated(ruleId, 1301, bytes32(uint256(keccak256("origin-tx"))), 9, false);
        vm.prank(address(system));
        agent.react(log);
    }

    function test_addRuleRejectsAnUnknownTemplate() public {
        RuleLib.Rule memory rule = _rule();
        rule.template = 14;
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(UnknownTemplate.selector, 14));
        agent.addRule(rule, false);
    }

    function test_addRuleStoresEveryParameterExactly() public {
        RuleLib.Rule memory rule = _rule();
        rule.template = 3;
        rule.threshold = 1_500e18;
        rule.secondary = 4_102_444_800;

        vm.prank(USER);
        uint256 ruleId = agent.addRule(rule, false);

        RuleLib.Rule memory stored = agent.getRule(ruleId);
        assertEq(stored.template, rule.template);
        assertEq(stored.chainId, rule.chainId);
        assertEq(stored.pair, rule.pair);
        assertEq(stored.tokenIn, rule.tokenIn);
        assertEq(stored.tokenOut, rule.tokenOut);
        assertEq(stored.amountIn, rule.amountIn);
        assertEq(stored.threshold, rule.threshold);
        assertEq(stored.secondary, rule.secondary);
        assertEq(stored.lastRun, 0);
        assertEq(stored.runs, 0);
        assertEq(stored.flags, RuleLib.FLAG_ACTIVE);
    }

    function test_addRuleSubscribesOnceForIdenticalTopics() public {
        uint256 first = _addRule();
        uint256 second = _addRule();
        assertEq(system.subscribeCount(), 1, "one shared cron subscription");

        vm.startPrank(USER);
        agent.pauseRule(first);
        assertEq(system.unsubscribeCount(), 0);
        agent.pauseRule(second);
        assertEq(system.unsubscribeCount(), 1);
        vm.stopPrank();
    }

    function test_addRuleRejectsAnAmountAboveThePerRunCeiling() public {
        uint256 ceiling = agent.MAX_SPEND_PER_RUN();
        RuleLib.Rule memory rule = _rule();
        rule.amountIn = ceiling + 1;

        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(ExceedsPerRunCap.selector, rule.amountIn, ceiling));
        agent.addRule(rule, false);
    }

    function test_addRuleRejectsASwapWithoutTokenOut() public {
        RuleLib.Rule memory rule = _rule();
        rule.tokenOut = address(0);

        vm.prank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        agent.addRule(rule, false);
    }

    function test_addRuleAcceptsAlertTemplatesWithZeroAmount() public {
        RuleLib.Rule memory rule;
        rule.template = 11;
        rule.chainId = 1301;
        rule.pair = address(pair);
        rule.threshold = 2_000e18;

        vm.prank(USER);
        uint256 ruleId = agent.addRule(rule, false);
        assertEq(agent.getRule(ruleId).amountIn, 0);
    }

    // --- T168: the price cache only ever moves forward -------------------------------------

    function _reactAsSystem(IReactive.LogRecord memory log) internal {
        vm.prank(address(system));
        agent.react(log);
    }

    function _syncLogAt(uint256 blockNumber, uint112 reserve0, uint112 reserve1)
        internal
        view
        returns (IReactive.LogRecord memory log)
    {
        log.chain_id = 1301;
        log._contract = address(pair);
        log.topic_0 = uint256(keccak256("Sync(uint112,uint112)"));
        log.data = abi.encode(reserve0, reserve1);
        log.block_number = blockNumber;
        log.tx_hash = uint256(keccak256(abi.encode(blockNumber)));
        log.log_index = blockNumber;
    }

    function test_newerSyncReplacesTheCachedPrice() public {
        _reactAsSystem(_syncLogAt(10, 2e6, 1e18));
        _reactAsSystem(_syncLogAt(11, 3e6, 1e18));
        (uint256 price,) = agent.getCachedPrice(address(pair));
        assertEq(price, 3e18);
    }

    function test_olderSyncIsIgnored() public {
        _reactAsSystem(_syncLogAt(20, 2e6, 1e18));
        _reactAsSystem(_syncLogAt(19, 5e6, 1e18));
        (uint256 price,) = agent.getCachedPrice(address(pair));
        assertEq(price, 2e18, "an older observation must not overwrite a newer one");
    }

    function test_quietPairKeepsItsStaleValueAndObservationTime() public {
        vm.warp(1_700_000_000);
        _reactAsSystem(_syncLogAt(30, 2e6, 1e18));
        (uint256 price, uint64 observedAt) = agent.getCachedPrice(address(pair));
        assertEq(price, 2e18);
        assertEq(observedAt, uint64(block.timestamp));

        vm.warp(1_700_000_600);
        IReactive.LogRecord memory unrelated;
        unrelated.chain_id = 1301;
        unrelated.tx_hash = 1;
        _reactAsSystem(unrelated);

        (price, observedAt) = agent.getCachedPrice(address(pair));
        assertEq(price, 2e18, "a quiet pair keeps its last traded price");
        assertEq(observedAt, uint64(1_700_000_000), "the observation time does not move");
    }
}


// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {RuleRegistry} from "../../src/registry/RuleRegistry.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {NotOwner} from "../../src/shared/Errors.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract RuleRegistryTest is Test {
    address internal constant USER = address(0xA11CE);
    address internal constant STRANGER = address(0xB0B);

    MockSystemContract internal system;
    RuleRegistry internal registry;
    Agent internal agent;
    uint256 internal ruleId;
    bytes32 internal paramsHash;

    function setUp() public {
        system = new MockSystemContract();
        registry = new RuleRegistry();
        AgentFactory factory = new AgentFactory(IReactiveSystem(address(system)), registry);
        agent = Agent(factory.deploy(USER));

        RuleLib.Rule memory rule;
        rule.template = 1;
        rule.chainId = 1301;
        rule.pair = address(0xCC);
        rule.tokenIn = address(0xAA);
        rule.tokenOut = address(0xBB);
        rule.amountIn = 10e6;
        paramsHash = RuleLib.paramsHash(rule);

        vm.prank(USER);
        ruleId = agent.addRule(rule, false);
    }

    function test_onlyTheAuthorMayList() public {
        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        registry.list(address(agent), ruleId, "ipfs://rule");
    }

    function test_listingIncrementsCountAndStoresTheHash() public {
        vm.prank(USER);
        registry.list(address(agent), ruleId, "ipfs://rule");
        assertEq(registry.listingCount(), 1);
        RuleRegistry.Listing memory listing = registry.getListing(address(agent), ruleId);
        assertEq(listing.author, USER);
        assertEq(listing.paramsHash, paramsHash);
        assertTrue(listing.isPublic);
    }

    function test_paramsHashIsStableForIdenticalParams() public pure {
        RuleLib.Rule memory first;
        first.template = 3;
        first.chainId = 1301;
        first.pair = address(0xCC);
        first.tokenIn = address(0xAA);
        first.tokenOut = address(0xBB);
        first.amountIn = 10e6;
        first.threshold = 1_500e18;
        first.secondary = 1_700_000_000;

        RuleLib.Rule memory second = first;
        second.lastRun = 999;
        second.runs = 4;
        assertEq(RuleLib.paramsHash(first), RuleLib.paramsHash(second));
    }

    function test_onlyTheAuthorMayDelist() public {
        vm.prank(USER);
        registry.list(address(agent), ruleId, "ipfs://rule");

        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        registry.delist(address(agent), ruleId);

        vm.prank(USER);
        registry.delist(address(agent), ruleId);
        assertEq(registry.listingCount(), 0);
        assertFalse(registry.isListed(address(agent), ruleId));
    }

    function test_listingAgainDoesNotDoubleCount() public {
        vm.startPrank(USER);
        registry.list(address(agent), ruleId, "ipfs://one");
        registry.list(address(agent), ruleId, "ipfs://two");
        vm.stopPrank();
        assertEq(registry.listingCount(), 1);
    }
}

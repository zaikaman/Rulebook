// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

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
    address internal agent;
    bytes32 internal paramsHash;

    function setUp() public {
        system = new MockSystemContract();
        registry = new RuleRegistry();
        AgentFactory factory = new AgentFactory(IReactiveSystem(address(system)));
        agent = factory.deploy(USER);

        RuleLib.Rule memory rule;
        rule.template = 1;
        rule.chainId = 1301;
        rule.pair = address(0xCC);
        rule.tokenIn = address(0xAA);
        rule.tokenOut = address(0xBB);
        rule.amountIn = 10e6;
        paramsHash = RuleLib.paramsHash(rule);
    }

    function test_onlyTheAuthorMayList() public {
        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        registry.list(1, paramsHash, "ipfs://rule", agent, 0);
    }

    function test_listingIncrementsCountAndStoresTheHash() public {
        vm.prank(USER);
        registry.list(1, paramsHash, "ipfs://rule", agent, 0);
        assertEq(registry.listingCount(), 1);
        RuleRegistry.Listing memory listing = registry.getListing(agent, 0);
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
        registry.list(1, paramsHash, "ipfs://rule", agent, 0);

        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        registry.delist(agent, 0);

        vm.prank(USER);
        registry.delist(agent, 0);
        assertEq(registry.listingCount(), 0);
        assertFalse(registry.isListed(agent, 0));
    }

    function test_listingAgainDoesNotDoubleCount() public {
        vm.startPrank(USER);
        registry.list(1, paramsHash, "ipfs://one", agent, 0);
        registry.list(1, paramsHash, "ipfs://two", agent, 0);
        vm.stopPrank();
        assertEq(registry.listingCount(), 1);
    }
}

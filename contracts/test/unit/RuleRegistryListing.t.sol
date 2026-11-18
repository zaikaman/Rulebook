// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {RuleRegistry} from "../../src/registry/RuleRegistry.sol";
import {InvalidTemplateParams, NotOwner} from "../../src/shared/Errors.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

/// @notice T207: the registry derives the hash from the stored rule, only the author writes, and
/// no listing path can move funds.
contract RuleRegistryListingTest is Test {
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
        AgentFactory factory = new AgentFactory(IReactiveSystem(address(system)), registry);
        agent = Agent(factory.deploy(USER));
        factory.deploy(STRANGER);
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

    function test_onlyTheAuthorMayList() public {
        uint256 ruleId = _addRule();
        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        registry.list(address(agent), ruleId, "ipfs://rule");
    }

    function test_onlyTheAuthorMayDelist() public {
        uint256 ruleId = _addRule();
        vm.prank(USER);
        registry.list(address(agent), ruleId, "ipfs://rule");

        vm.prank(STRANGER);
        vm.expectRevert(NotOwner.selector);
        registry.delist(address(agent), ruleId);
    }

    function test_listDerivesTheHashFromTheStoredRule() public {
        uint256 ruleId = _addRule();
        vm.prank(USER);
        registry.list(address(agent), ruleId, "ipfs://rule");

        RuleRegistry.Listing memory listing = registry.getListing(address(agent), ruleId);
        assertEq(listing.author, USER);
        assertEq(listing.template, 1);
        assertEq(listing.paramsHash, RuleLib.paramsHash(agent.getRule(ruleId)));
        assertEq(listing.metadataURI, "ipfs://rule");
        assertTrue(listing.isPublic);
    }

    function test_hashIsStableWhenOnlyRuntimeStateChanges() public {
        uint256 ruleId = _addRule();
        vm.prank(USER);
        registry.list(address(agent), ruleId, "ipfs://rule");
        bytes32 listedHash = registry.getListing(address(agent), ruleId).paramsHash;

        // Pausing changes `flags`, which is not a user-chosen parameter.
        vm.prank(USER);
        agent.pauseRule(ruleId);

        assertEq(RuleLib.paramsHash(agent.getRule(ruleId)), listedHash);
    }

    function test_listRejectsARuleTheAgentDoesNotOwn() public {
        vm.prank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        registry.list(address(agent), 99, "ipfs://missing");
    }

    function test_listingCountTracksListingsWithoutDoubleCounting() public {
        uint256 first = _addRule();
        uint256 second = _addRule();

        vm.startPrank(USER);
        registry.list(address(agent), first, "ipfs://one");
        registry.list(address(agent), second, "ipfs://two");
        assertEq(registry.listingCount(), 2);

        // Re-listing the same rule updates metadata and keeps the count.
        registry.list(address(agent), first, "ipfs://one-updated");
        assertEq(registry.listingCount(), 2);
        assertEq(registry.getListing(address(agent), first).metadataURI, "ipfs://one-updated");

        registry.delist(address(agent), first);
        assertEq(registry.listingCount(), 1);
        assertFalse(registry.isListed(address(agent), first));
        assertTrue(registry.isListed(address(agent), second));
        vm.stopPrank();
    }

    function test_delistingTwiceRevertsInsteadOfUnderflowing() public {
        uint256 ruleId = _addRule();
        vm.startPrank(USER);
        registry.list(address(agent), ruleId, "ipfs://rule");
        registry.delist(address(agent), ruleId);
        vm.expectRevert(NotOwner.selector);
        registry.delist(address(agent), ruleId);
        vm.stopPrank();
        assertEq(registry.listingCount(), 0);
    }

    /// @notice The registry holds no funds and listing never touches a token balance.
    function test_listingAndDelistingMoveNoFunds() public {
        uint256 ruleId = _addRule();
        usdc.mint(USER, 1_000e6);
        uint256 before = usdc.balanceOf(USER);

        vm.startPrank(USER);
        registry.list(address(agent), ruleId, "ipfs://rule");
        registry.delist(address(agent), ruleId);
        vm.stopPrank();

        assertEq(usdc.balanceOf(USER), before);
        assertEq(usdc.balanceOf(address(registry)), 0);
        assertEq(weth.balanceOf(address(registry)), 0);
    }
}

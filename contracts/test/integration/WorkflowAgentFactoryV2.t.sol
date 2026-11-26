// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {ChainConfig} from "../../src/chain/ChainConfig.sol";
import {WorkflowAgentFactoryV2} from "../../src/workflow/v2/WorkflowAgentFactoryV2.sol";
import {WorkflowAgentV2} from "../../src/workflow/v2/WorkflowAgentV2.sol";
import {WorkflowProgramV2 as P} from "../../src/workflow/v2/WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "../../src/workflow/v2/WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "../../src/workflow/v2/WorkflowProtocolsV2.sol";
import {WorkflowVaultV2} from "../../src/workflow/v2/WorkflowVaultV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract WorkflowAgentFactoryV2Test is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant OTHER = address(0xB0B);
    address private constant STRANGER = address(0xCAFE);
    address private constant PROXY = address(0xCA11);
    address private constant RECIPIENT = address(0xBEEF);
    bytes32 private constant WORKFLOW = keccak256("workflow");
    bytes32 private constant OTHER_WORKFLOW = keccak256("other workflow");
    string private constant TITLE = "Daily transfer";
    string private constant DESCRIPTION = "Moves 1 USDC to the recipient every hour.";

    MockSystemContract private system;
    WorkflowAgentFactoryV2 private factory;
    WorkflowAgentV2 private agent;
    WorkflowVaultV2 private vault;
    WorkflowProgramValidatorV2 private validator;
    bytes private encoded;
    bytes32 private programHash;

    function setUp() public {
        vm.warp(12 hours);
        vm.chainId(ChainConfig.LASNA);
        system = new MockSystemContract();
        factory = new WorkflowAgentFactoryV2(system);
        validator = new WorkflowProgramValidatorV2();
        vm.prank(OWNER);
        agent = WorkflowAgentV2(payable(factory.create()));
        vault = _vault(OWNER, address(agent));
        encoded = abi.encode(_program(1e6));
        programHash = keccak256(encoded);
        vm.startPrank(OWNER);
        agent.linkVault(P.UNICHAIN_SEPOLIA, address(vault));
        vault.authorize(WORKFLOW, 1, encoded, TITLE);
        agent.enable(WORKFLOW, 1, encoded, TITLE, uint64(block.number));
        vm.stopPrank();
    }

    function testCreateReturnsTheSameAgentPerOwnerAndEmitsOnlyOnce() public {
        assertEq(factory.agentOf(OWNER), address(agent));

        vm.recordLogs();
        vm.prank(OWNER);
        assertEq(factory.create(), address(agent), "a repeat call reuses the agent");
        assertEq(vm.getRecordedLogs().length, 0, "reusing an agent emits nothing");

        vm.expectEmit(true, false, false, true, address(factory));
        emit WorkflowAgentFactoryV2.AgentCreated(OTHER, address(0));
        vm.prank(OTHER);
        address otherAgent = factory.create();
        assertTrue(otherAgent != address(0) && otherAgent != address(agent));
        assertEq(factory.agentOf(OTHER), otherAgent);
        assertEq(WorkflowAgentV2(payable(otherAgent)).owner(), OTHER);
        assertEq(WorkflowAgentV2(payable(otherAgent)).factory(), address(factory));
    }

    function testPublishCreatesAVisibleListingWithSignedMetadata() public {
        vm.expectEmit(true, true, true, true, address(factory));
        emit WorkflowAgentFactoryV2.Published(
            1, OWNER, address(agent), WORKFLOW, programHash, P.UNICHAIN_SEPOLIA, TITLE, DESCRIPTION
        );
        vm.prank(OWNER);
        uint256 id = factory.publish(WORKFLOW, DESCRIPTION);

        assertEq(id, 1);
        assertEq(factory.listingCount(), 1);
        assertEq(factory.listingOf(address(agent), WORKFLOW, programHash), 1);
        (address owner, address listingAgent, bytes32 workflow, bytes32 hash, bool visible) =
            factory.listings(id);
        assertEq(owner, OWNER);
        assertEq(listingAgent, address(agent));
        assertEq(workflow, WORKFLOW);
        assertEq(hash, programHash);
        assertTrue(visible);
    }

    function testPublishRejectsADuplicateOfAVisibleListing() public {
        vm.prank(OWNER);
        factory.publish(WORKFLOW, DESCRIPTION);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidListing.selector);
        factory.publish(WORKFLOW, "A second description");
        assertEq(factory.listingCount(), 1);
    }

    function testUnpublishHidesTheListingAndRepublishReusesItsId() public {
        vm.startPrank(OWNER);
        uint256 id = factory.publish(WORKFLOW, DESCRIPTION);
        vm.expectEmit(true, false, false, true, address(factory));
        emit WorkflowAgentFactoryV2.Unpublished(id);
        factory.unpublish(id);
        (,,,, bool visible) = factory.listings(id);
        assertFalse(visible);

        (bytes32 signedHash,,) = agent.publication(WORKFLOW);
        assertEq(signedHash, programHash, "the signed version is unchanged");
        vm.expectEmit(true, true, true, true, address(factory));
        emit WorkflowAgentFactoryV2.Published(
            id, OWNER, address(agent), WORKFLOW, programHash, P.UNICHAIN_SEPOLIA, TITLE, DESCRIPTION
        );
        assertEq(factory.publish(WORKFLOW, DESCRIPTION), id, "republishing keeps the listing id");
        vm.stopPrank();
        assertEq(factory.listingCount(), 1);
        (,,,, visible) = factory.listings(id);
        assertTrue(visible);
    }

    function testUnpublishRejectsNonOwnersAndHiddenListings() public {
        vm.prank(OWNER);
        uint256 id = factory.publish(WORKFLOW, DESCRIPTION);

        vm.prank(STRANGER);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidListing.selector);
        factory.unpublish(id);

        vm.prank(OWNER);
        factory.unpublish(id);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidListing.selector);
        factory.unpublish(id);
        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidListing.selector);
        factory.unpublish(id + 1);
    }

    function testPublishRequiresAnAgentAndAnEnabledWorkflow() public {
        vm.prank(STRANGER);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidListing.selector);
        factory.publish(WORKFLOW, DESCRIPTION);

        vm.prank(OWNER);
        vm.expectRevert(WorkflowAgentV2.InvalidWorkflow.selector);
        factory.publish(OTHER_WORKFLOW, DESCRIPTION);
        assertEq(factory.listingCount(), 0);
    }

    function testPublishEnforcesTheDescriptionBounds() public {
        vm.startPrank(OWNER);
        vm.expectRevert(WorkflowAgentFactoryV2.InvalidListing.selector);
        factory.publish(WORKFLOW, "");

        vm.expectRevert(WorkflowAgentFactoryV2.InvalidListing.selector);
        factory.publish(WORKFLOW, new string(281));

        assertEq(factory.publish(WORKFLOW, new string(280)), 1, "280 bytes is accepted");
        vm.stopPrank();
    }

    function testListingsAreScopedPerAgentAndSignedVersion() public {
        vm.startPrank(OWNER);
        assertEq(factory.publish(WORKFLOW, DESCRIPTION), 1);
        bytes memory updated = abi.encode(_program(2e6));
        vault.authorize(WORKFLOW, 2, updated, TITLE);
        agent.enable(WORKFLOW, 2, updated, TITLE, uint64(block.number));
        bytes32 updatedHash = keccak256(updated);
        assertEq(factory.listingOf(address(agent), WORKFLOW, programHash), 1);
        assertEq(
            factory.listingOf(address(agent), WORKFLOW, updatedHash),
            0,
            "a new signed version starts unpublished"
        );
        assertEq(factory.publish(WORKFLOW, DESCRIPTION), 2);
        assertEq(factory.listingOf(address(agent), WORKFLOW, updatedHash), 2);
        vm.stopPrank();

        vm.prank(OTHER);
        WorkflowAgentV2 otherAgent = WorkflowAgentV2(payable(factory.create()));
        WorkflowVaultV2 otherVault = _vault(OTHER, address(otherAgent));
        vm.startPrank(OTHER);
        otherAgent.linkVault(P.UNICHAIN_SEPOLIA, address(otherVault));
        otherVault.authorize(WORKFLOW, 1, encoded, TITLE);
        otherAgent.enable(WORKFLOW, 1, encoded, TITLE, uint64(block.number));
        assertEq(
            factory.listingOf(address(otherAgent), WORKFLOW, programHash),
            0,
            "another agent starts with no listing"
        );
        assertEq(factory.publish(WORKFLOW, DESCRIPTION), 3);
        vm.stopPrank();
        assertEq(factory.listingOf(address(otherAgent), WORKFLOW, programHash), 3);
        assertEq(factory.listingCount(), 3);
    }

    function testConstructorRejectsNonAutomationChains() public {
        vm.chainId(31337);
        vm.expectRevert(WorkflowAgentFactoryV2.InactiveDeployment.selector);
        new WorkflowAgentFactoryV2(system);

        vm.expectRevert(WorkflowAgentV2.InvalidWorkflow.selector);
        new WorkflowAgentV2(system, address(factory), validator);

        vm.chainId(ChainConfig.UNICHAIN_SEPOLIA);
        vm.expectRevert(WorkflowAgentFactoryV2.InactiveDeployment.selector);
        new WorkflowAgentFactoryV2(system);

        vm.expectRevert(WorkflowAgentV2.InvalidWorkflow.selector);
        new WorkflowAgentV2(system, address(factory), validator);
    }

    function _vault(address owner, address agent_) private returns (WorkflowVaultV2) {
        MockERC20 usdc = new MockERC20("USDC", "USDC", 6);
        MockERC20 weth = new MockERC20("WETH", "WETH", 18);
        MockPair pair = new MockPair(address(usdc), address(weth));
        MockRouter router = new MockRouter();
        router.setPair(address(pair));
        WorkflowProtocolsV2.Networks memory market;
        market.usdc = address(usdc);
        market.weth = address(weth);
        market.pair = address(pair);
        market.router = address(router);
        return new WorkflowVaultV2(PROXY, owner, agent_, P.UNICHAIN_SEPOLIA, market, validator);
    }

    function _program(uint96 amount) private pure returns (P.Program memory program) {
        P.Node[] memory nodes = new P.Node[](1);
        nodes[0].actions = new P.Action[](1);
        nodes[0].actions[0] = P.Action(P.SEND, P.FIXED, amount, RECIPIENT);
        program.version = 2;
        program.chain = P.UNICHAIN_SEPOLIA;
        program.originChain = P.UNICHAIN_SEPOLIA;
        program.trigger = P.PAYMENT;
        program.usdcCap = 2e6;
        program.wethCap = 0.1 ether;
        program.slippage = 100;
        program.nodes = nodes;
    }
}

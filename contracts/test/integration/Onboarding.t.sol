// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {RuleRegistry} from "../../src/registry/RuleRegistry.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {
    AgentNotLinked,
    InvalidTemplateParams,
    NotAgent,
    NotOwner
} from "../../src/shared/Errors.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {VaultFactory} from "../../src/vault/VaultFactory.sol";
import {MockCallbackProxy} from "../mocks/MockCallbackProxy.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

/// @notice Proves factory → agent → vault → registry wiring end to end, in the required order.
contract OnboardingTest is Test {
    address internal constant USER = address(0xA11CE);

    MockSystemContract internal system;
    MockCallbackProxy internal proxy;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockPair internal pair;
    AgentFactory internal agentFactory;
    VaultFactory internal vaultFactory;
    RuleRegistry internal registry;

    function setUp() public {
        vm.chainId(1301);
        system = new MockSystemContract();
        proxy = new MockCallbackProxy();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pair = new MockPair(address(usdc), address(weth));
        agentFactory = new AgentFactory(IReactiveSystem(address(system)));
        vaultFactory = new VaultFactory(IPayable(payable(address(proxy))));
        registry = new RuleRegistry();
    }

    function test_fullOnboardingWiring() public {
        address agent = agentFactory.deploy(USER);
        address vault = vaultFactory.deploy(USER, agent, address(usdc), address(weth));

        vm.prank(USER);
        Agent(agent).linkVault(1301, vault);
        assertEq(Agent(agent).getVault(1301), vault);
        assertEq(Vault(payable(vault)).owner(), USER);
        assertEq(Vault(payable(vault)).agent(), agent);

        RuleLib.Rule memory rule;
        rule.template = 1;
        rule.chainId = 1301;
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.tokenOut = address(weth);
        rule.amountIn = 10e6;

        vm.prank(USER);
        uint256 ruleId = Agent(agent).addRule(rule, true);
        assertEq(ruleId, 0);
        assertEq(Agent(agent).getRuleIds().length, 1);

        vm.prank(USER);
        registry.list(1, RuleLib.paramsHash(rule), "ipfs://dca", agent, ruleId);
        assertEq(registry.listingCount(), 1);
        assertEq(registry.getListing(agent, ruleId).author, USER);
    }

    function test_repeatedOnboardingDoesNotDuplicate() public {
        address agent = agentFactory.deploy(USER);
        vaultFactory.deploy(USER, agent, address(usdc), address(weth));

        vm.expectRevert();
        agentFactory.deploy(USER);

        vm.expectRevert();
        vaultFactory.deploy(USER, agent, address(usdc), address(weth));
    }

    function test_agentCanBeDeployedWithoutAVault() public {
        address agent = agentFactory.deploy(USER);
        assertEq(Agent(agent).owner(), USER);
        assertEq(Agent(agent).getVault(1301), address(0));
    }

    function test_vaultDeployRejectsAnAddressWithNoAgentCode() public {
        vm.expectRevert(NotAgent.selector);
        vaultFactory.deploy(USER, address(0), address(usdc), address(weth));
    }

    function test_linkVaultIsOwnerOnly() public {
        address agent = agentFactory.deploy(USER);
        address vault = vaultFactory.deploy(USER, agent, address(usdc), address(weth));

        vm.prank(address(0xB0B));
        vm.expectRevert();
        Agent(agent).linkVault(1301, vault);
    }

    function test_linkVaultRejectsAVaultForAnotherAgent() public {
        address agent = agentFactory.deploy(USER);
        address strangerAgent = agentFactory.deploy(address(0xB0B));
        address strangerVault =
            vaultFactory.deploy(address(0xB0B), strangerAgent, address(usdc), address(weth));

        vm.prank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        Agent(agent).linkVault(1301, strangerVault);
    }

    function test_linkVaultRejectsUnsupportedChainAndZeroAddress() public {
        address agent = agentFactory.deploy(USER);
        address vault = vaultFactory.deploy(USER, agent, address(usdc), address(weth));

        vm.startPrank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        Agent(agent).linkVault(1, vault);
        vm.expectRevert(InvalidTemplateParams.selector);
        Agent(agent).linkVault(1301, address(0));
        vm.stopPrank();
    }

    function test_linkVaultEmitsAndRefusesRelinkToAnotherVault() public {
        address agent = agentFactory.deploy(USER);
        address vault = vaultFactory.deploy(USER, agent, address(usdc), address(weth));

        vm.expectEmit(true, true, false, true, agent);
        emit Agent.VaultLinked(1301, vault);
        vm.prank(USER);
        Agent(agent).linkVault(1301, vault);

        vm.prank(USER);
        Agent(agent).linkVault(1301, vault);
        assertEq(Agent(agent).getVault(1301), vault);
    }

    function test_unlinkedVaultRejectsExecute() public {
        address agent = agentFactory.deploy(USER);
        address vault = vaultFactory.deploy(USER, agent, address(usdc), address(weth));
        bytes memory payload = abi.encode(
            uint16(1), address(usdc), uint256(0), uint256(50), uint64(type(uint64).max), uint256(0)
        );

        vm.prank(address(proxy));
        vm.expectRevert(AgentNotLinked.selector);
        Vault(payable(vault)).execute(agent, 0, payload);

        vm.prank(USER);
        Agent(agent).linkVault(1301, vault);

        vm.prank(address(proxy));
        vm.expectRevert();
        Vault(payable(vault)).execute(agent, 0, payload);
    }

    function test_withdrawReturnsTheFullPrincipalToTheOwner() public {
        address agent = agentFactory.deploy(USER);
        address vault = vaultFactory.deploy(USER, agent, address(usdc), address(weth));
        vm.prank(USER);
        Agent(agent).linkVault(1301, vault);

        usdc.mint(USER, 25e6);
        vm.startPrank(USER);
        usdc.approve(vault, 25e6);
        Vault(payable(vault)).deposit(address(usdc), 25e6);
        Vault(payable(vault)).withdraw(address(usdc), 25e6, USER);
        vm.stopPrank();

        assertEq(usdc.balanceOf(USER), 25e6);
        assertEq(Vault(payable(vault)).principalOf(address(usdc)), 0);

        vm.prank(USER);
        Vault(payable(vault)).setPaused(true);
        // Withdrawal is allowed while paused, but the principal is already gone.
        vm.prank(USER);
        vm.expectRevert();
        Vault(payable(vault)).withdraw(address(usdc), 1, USER);
    }

    function test_ownerIsNeverTheFactoryOrOperator() public {
        address agent = agentFactory.deploy(USER);
        address vault = vaultFactory.deploy(USER, agent, address(usdc), address(weth));
        assertEq(Agent(agent).owner(), USER);
        assertEq(Vault(payable(vault)).owner(), USER);
        assertTrue(Agent(agent).owner() != address(agentFactory));
        assertTrue(Vault(payable(vault)).owner() != address(vaultFactory));
        assertEq(Vault(payable(vault)).agent(), agent);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {RuleRegistry} from "../../src/registry/RuleRegistry.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
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
}

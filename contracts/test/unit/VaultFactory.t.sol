// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {VaultFactory} from "../../src/vault/VaultFactory.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {AgentAlreadyLinked, NotAgent, NotOwner} from "../../src/shared/Errors.sol";
import {MockCallbackProxy} from "../mocks/MockCallbackProxy.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract VaultFactoryTest is Test {
    address internal constant USER = address(0xA11CE);
    address internal constant STRANGER = address(0xB0B);

    MockSystemContract internal system;
    MockCallbackProxy internal proxy;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    AgentFactory internal agentFactory;
    VaultFactory internal vaultFactory;
    address internal agent;

    function setUp() public {
        vm.chainId(1301);
        system = new MockSystemContract();
        proxy = new MockCallbackProxy();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        agentFactory = new AgentFactory(IReactiveSystem(address(system)));
        vaultFactory = new VaultFactory(IPayable(payable(address(proxy))));
        agent = agentFactory.deploy(USER);
    }

    function test_deployRequiresAnExistingAgent() public {
        vm.expectRevert(NotAgent.selector);
        vaultFactory.deploy(USER, address(0xDEAD), address(usdc), address(weth));
    }

    function test_deployRequiresMatchingAgentOwner() public {
        vm.expectRevert(NotOwner.selector);
        vaultFactory.deploy(STRANGER, agent, address(usdc), address(weth));
    }

    function test_deploySetsOwnerToTheUserAndPopulatesVaultOf() public {
        address vault = vaultFactory.deploy(USER, agent, address(usdc), address(weth));
        assertEq(vaultFactory.vaultOf(USER), vault);
        assertEq(Vault(payable(vault)).owner(), USER);
        assertEq(Vault(payable(vault)).agent(), agent);
        assertEq(vaultFactory.vaultChainOf(USER), 1301);
        assertEq(address(vaultFactory.callbackProxy()), address(proxy));
        assertEq(vaultFactory.DEFAULT_MAX_SPEND_PER_RUN(), 100e6);
    }

    function test_secondDeployForSameOwnerReverts() public {
        vaultFactory.deploy(USER, agent, address(usdc), address(weth));
        vm.expectRevert(AgentAlreadyLinked.selector);
        vaultFactory.deploy(USER, agent, address(usdc), address(weth));
    }

    function test_deployEmitsVaultDeployed() public {
        address expected =
            vm.computeCreateAddress(address(vaultFactory), vm.getNonce(address(vaultFactory)));
        vm.expectEmit(true, true, true, true, address(vaultFactory));
        emit VaultFactory.VaultDeployed(USER, expected, agent, 1301);
        vaultFactory.deploy(USER, agent, address(usdc), address(weth));
    }
}

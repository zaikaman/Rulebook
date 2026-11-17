// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {RuleRegistry} from "../../src/registry/RuleRegistry.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {InvalidTemplateParams} from "../../src/shared/Errors.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {VaultFactory} from "../../src/vault/VaultFactory.sol";
import {MockCallbackProxy} from "../mocks/MockCallbackProxy.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

/// @notice Proves factory → agent → vault → registry wiring end to end, in the required order.
contract OnboardingTest is Test {
    uint256 internal constant USER_KEY = 0xA11CE;
    uint256 internal constant STRANGER_KEY = 0xB0B;
    address internal USER;
    address internal STRANGER;

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
        USER = vm.addr(USER_KEY);
        STRANGER = vm.addr(STRANGER_KEY);
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
        address vault = _deployVault(USER, USER_KEY, agent);

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
        _deployVault(USER, USER_KEY, agent);

        vm.expectRevert();
        agentFactory.deploy(USER);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _authorization(USER, USER_KEY, agent, deadline);
        vm.expectRevert();
        vaultFactory.deploy(USER, agent, address(usdc), address(weth), deadline, signature);
    }

    function test_agentCanBeDeployedWithoutAVault() public {
        address agent = agentFactory.deploy(USER);
        assertEq(Agent(agent).owner(), USER);
        assertEq(Agent(agent).getVault(1301), address(0));
    }

    function test_vaultDeploymentBindsOwnerAuthorizedRemoteAgent() public {
        address vault = _deployVault(USER, USER_KEY, address(0xDEAD));
        assertEq(Vault(payable(vault)).agent(), address(0xDEAD));
    }

    function test_linkVaultIsOwnerOnly() public {
        address agent = agentFactory.deploy(USER);
        address vault = _deployVault(USER, USER_KEY, agent);

        vm.prank(STRANGER);
        vm.expectRevert();
        Agent(agent).linkVault(1301, vault);
    }

    function test_linkVaultStoresOwnerAuthorizedCrossChainMetadata() public {
        address agent = agentFactory.deploy(USER);
        address strangerAgent = agentFactory.deploy(address(0xB0B));
        address strangerVault = _deployVault(STRANGER, STRANGER_KEY, strangerAgent);

        vm.prank(USER);
        Agent(agent).linkVault(1301, strangerVault);
        assertEq(Agent(agent).getVault(1301), strangerVault);
    }

    function test_linkVaultRejectsUnsupportedChainAndZeroAddress() public {
        address agent = agentFactory.deploy(USER);
        address vault = _deployVault(USER, USER_KEY, agent);

        vm.startPrank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        Agent(agent).linkVault(1, vault);
        vm.expectRevert(InvalidTemplateParams.selector);
        Agent(agent).linkVault(1301, address(0));
        vm.stopPrank();
    }

    function test_linkVaultEmitsAndRefusesRelinkToAnotherVault() public {
        address agent = agentFactory.deploy(USER);
        address vault = _deployVault(USER, USER_KEY, agent);

        vm.expectEmit(true, true, false, true, agent);
        emit Agent.VaultLinked(1301, vault);
        vm.prank(USER);
        Agent(agent).linkVault(1301, vault);

        vm.prank(USER);
        Agent(agent).linkVault(1301, vault);
        assertEq(Agent(agent).getVault(1301), vault);
    }

    function test_callbackRemainsBoundToTheOwnerAuthorizedAgent() public {
        address agent = agentFactory.deploy(USER);
        address vault = _deployVault(USER, USER_KEY, agent);
        bytes memory payload = abi.encode(
            uint16(1), address(usdc), uint256(0), uint256(50), uint64(type(uint64).max), uint256(0)
        );

        vm.prank(address(proxy));
        vm.expectRevert();
        Vault(payable(vault)).execute(agent, 0, payload);

        vm.prank(USER);
        Agent(agent).linkVault(1301, vault);

        vm.prank(address(proxy));
        vm.expectRevert();
        Vault(payable(vault)).execute(agent, 0, payload);
    }

    function test_withdrawReturnsTheFullPrincipalToTheOwner() public {
        address agent = agentFactory.deploy(USER);
        address vault = _deployVault(USER, USER_KEY, agent);
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
        address vault = _deployVault(USER, USER_KEY, agent);
        assertEq(Agent(agent).owner(), USER);
        assertEq(Vault(payable(vault)).owner(), USER);
        assertTrue(Agent(agent).owner() != address(agentFactory));
        assertTrue(Vault(payable(vault)).owner() != address(vaultFactory));
        assertEq(Vault(payable(vault)).agent(), agent);
    }

    function _deployVault(address owner, uint256 ownerKey, address agent)
        private
        returns (address)
    {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _authorization(owner, ownerKey, agent, deadline);
        return vaultFactory.deploy(owner, agent, address(usdc), address(weth), deadline, signature);
    }

    function _authorization(address owner, uint256 ownerKey, address agent, uint256 deadline)
        private
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                vaultFactory.VAULT_DEPLOYMENT_TYPEHASH(),
                owner,
                agent,
                address(usdc),
                address(weth),
                vaultFactory.nonces(owner),
                deadline
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Rulebook Vault Factory"),
                keccak256("1"),
                block.chainid,
                address(vaultFactory)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}

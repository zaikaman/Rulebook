// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {VaultFactory} from "../../src/vault/VaultFactory.sol";
import {IReactiveSystem} from "../../src/shared/ReactiveTypes.sol";
import {AgentAlreadyLinked, InvalidVaultAuthorization} from "../../src/shared/Errors.sol";
import {MockCallbackProxy} from "../mocks/MockCallbackProxy.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract VaultFactoryTest is Test {
    uint256 internal constant USER_KEY = 0xA11CE;
    uint256 internal constant STRANGER_KEY = 0xB0B;
    address internal USER;
    address internal STRANGER;

    MockSystemContract internal system;
    MockCallbackProxy internal proxy;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    AgentFactory internal agentFactory;
    VaultFactory internal vaultFactory;
    address internal agent;

    function setUp() public {
        vm.chainId(1301);
        USER = vm.addr(USER_KEY);
        STRANGER = vm.addr(STRANGER_KEY);
        system = new MockSystemContract();
        proxy = new MockCallbackProxy();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        agentFactory = new AgentFactory(IReactiveSystem(address(system)));
        vaultFactory = new VaultFactory(IPayable(payable(address(proxy))));
        agent = agentFactory.deploy(USER);
    }

    function test_deployRequiresOwnerAuthorizationForThisAgent() public {
        (uint256 deadline, bytes memory signature) = _authorization(
            USER_KEY, USER, address(0xDEAD), address(usdc), address(weth)
        );
        vm.expectRevert(InvalidVaultAuthorization.selector);
        vaultFactory.deploy(STRANGER, agent, address(usdc), address(weth), deadline, signature);
    }

    function test_deploySetsOwnerToTheUserAndPopulatesVaultOf() public {
        address vault = _deployVault(USER, USER_KEY, agent);
        assertEq(vaultFactory.vaultOf(USER), vault);
        assertEq(Vault(payable(vault)).owner(), USER);
        assertEq(Vault(payable(vault)).agent(), agent);
        assertEq(vaultFactory.vaultChainOf(USER), 1301);
        assertEq(address(vaultFactory.callbackProxy()), address(proxy));
        assertEq(vaultFactory.DEFAULT_MAX_SPEND_PER_RUN(), 100e6);
    }

    function test_secondDeployForSameOwnerReverts() public {
        _deployVault(USER, USER_KEY, agent);
        (uint256 deadline, bytes memory signature) =
            _authorization(USER_KEY, USER, agent, address(usdc), address(weth));
        vm.expectRevert(AgentAlreadyLinked.selector);
        vaultFactory.deploy(USER, agent, address(usdc), address(weth), deadline, signature);
    }

    function test_deployEmitsVaultDeployed() public {
        address expected =
            vm.computeCreateAddress(address(vaultFactory), vm.getNonce(address(vaultFactory)));
        vm.expectEmit(true, true, true, true, address(vaultFactory));
        emit VaultFactory.VaultDeployed(USER, expected, agent, 1301);
        _deployVault(USER, USER_KEY, agent);
    }

    function test_authorizationNonceIsConsumedOnce() public {
        (uint256 deadline, bytes memory signature) =
            _authorization(USER_KEY, USER, agent, address(usdc), address(weth));
        vaultFactory.deploy(USER, agent, address(usdc), address(weth), deadline, signature);
        assertEq(vaultFactory.nonces(USER), 1);
        vm.expectRevert(AgentAlreadyLinked.selector);
        vaultFactory.deploy(USER, agent, address(usdc), address(weth), deadline, signature);
    }

    function test_authorizationCannotBeReplayedForDifferentParameters() public {
        (uint256 deadline, bytes memory signature) =
            _authorization(USER_KEY, USER, agent, address(usdc), address(weth));
        vm.expectRevert(InvalidVaultAuthorization.selector);
        vaultFactory.deploy(USER, agent, address(weth), address(usdc), deadline, signature);
    }

    function test_authorizationExpires() public {
        (uint256 deadline, bytes memory signature) =
            _authorization(USER_KEY, USER, agent, address(usdc), address(weth));
        vm.warp(deadline + 1);
        vm.expectRevert(InvalidVaultAuthorization.selector);
        vaultFactory.deploy(USER, agent, address(usdc), address(weth), deadline, signature);
    }

    function _deployVault(address owner, uint256 ownerKey, address agent_) private returns (address) {
        (uint256 deadline, bytes memory signature) =
            _authorization(ownerKey, owner, agent_, address(usdc), address(weth));
        return vaultFactory.deploy(owner, agent_, address(usdc), address(weth), deadline, signature);
    }

    function _authorization(
        uint256 ownerKey,
        address owner,
        address agent_,
        address tokenIn,
        address tokenOut
    ) private returns (uint256 deadline, bytes memory signature) {
        deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                vaultFactory.VAULT_DEPLOYMENT_TYPEHASH(),
                owner,
                agent_,
                tokenIn,
                tokenOut,
                vaultFactory.nonces(owner),
                deadline
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Rulebook Vault Factory"),
                keccak256("1"),
                block.chainid,
                address(vaultFactory)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}

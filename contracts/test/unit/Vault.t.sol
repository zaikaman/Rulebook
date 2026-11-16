// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {Vault} from "../../src/vault/Vault.sol";
import {
    AgentNotLinked,
    CallbackSenderMismatch,
    ConditionNotMet,
    InvalidAmount,
    InvalidTemplateParams,
    NotOwner,
    NotServiceProvider,
    TokenMismatch,
    UnknownTemplate
} from "../../src/shared/Errors.sol";
import {MockAgentVaultRegistry} from "../mocks/MockAgentVaultRegistry.sol";
import {MockCallbackProxy} from "../mocks/MockCallbackProxy.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract VaultTest is Test {
    address internal constant USER = address(0xA11CE);
    address internal constant AGENT = address(0xA11CE00000000000000000000000000000000002);

    MockCallbackProxy internal proxy;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockAgentVaultRegistry internal agentRegistry;
    Vault internal vault;

    function setUp() public {
        proxy = new MockCallbackProxy();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        agentRegistry = new MockAgentVaultRegistry();
        vault = new Vault(
            IPayable(payable(address(proxy))),
            USER,
            address(agentRegistry),
            address(0x1234),
            address(usdc),
            address(weth),
            100e6,
            false
        );
        agentRegistry.setLinkedVault(address(vault));
    }

    function _fund(uint256 amount) internal {
        usdc.mint(USER, amount);
        vm.startPrank(USER);
        usdc.approve(address(vault), amount);
        vault.deposit(address(usdc), amount);
        vm.stopPrank();
    }

    function test_executeRejectsNonProxySender() public {
        vm.expectRevert(NotServiceProvider.selector);
        vault.execute(address(agentRegistry), 1, "");
    }

    function test_executeRejectsWrongFirstArgument() public {
        vm.prank(address(proxy));
        vm.expectRevert(
            abi.encodeWithSelector(
                CallbackSenderMismatch.selector, address(agentRegistry), address(0xBAD)
            )
        );
        vault.execute(address(0xBAD), 1, "");
    }

    function test_executeRejectsVaultTheAgentHasNotLinked() public {
        agentRegistry.setLinkedVault(address(0));
        bytes memory validPayload = abi.encode(
            uint16(1), address(usdc), uint256(0), uint256(50), uint64(type(uint64).max), uint256(0)
        );
        vm.prank(address(proxy));
        vm.expectRevert(AgentNotLinked.selector);
        vault.execute(address(agentRegistry), 1, validPayload);
    }

    function test_withdrawRejectsNonOwner() public {
        _fund(10e6);
        vm.prank(address(0xB0B));
        vm.expectRevert(NotOwner.selector);
        vault.withdraw(address(usdc), 10e6, address(0xB0B));
    }

    function test_setLimitsEnforcesAllowlist() public {
        vm.startPrank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        vault.setLimits(10e6, address(0), address(weth));

        vm.expectRevert(
            abi.encodeWithSelector(TokenMismatch.selector, address(usdc), address(usdc))
        );
        vault.setLimits(10e6, address(usdc), address(usdc));

        vault.setLimits(20e6, address(usdc), address(weth));
        assertEq(vault.maxSpendPerRun(), 20e6);
        vm.stopPrank();
    }

    function test_pausedBlocksExecuteButNotWithdraw() public {
        _fund(10e6);
        vm.prank(USER);
        vault.setPaused(true);

        vm.prank(address(proxy));
        vm.expectRevert(ConditionNotMet.selector);
        vault.execute(address(agentRegistry), 1, "");

        vm.prank(USER);
        vault.withdraw(address(usdc), 10e6, USER);
        assertEq(usdc.balanceOf(USER), 10e6);
        assertEq(vault.principalOf(address(usdc)), 0);
    }

    function test_balancesEmittedAfterDepositAndWithdraw() public {
        usdc.mint(USER, 10e6);
        vm.startPrank(USER);
        usdc.approve(address(vault), 10e6);

        vm.expectEmit(true, false, false, true, address(vault));
        emit Vault.Deposited(address(usdc), 10e6, USER);
        vm.expectEmit(false, false, false, true, address(vault));
        emit Vault.Balances(address(usdc), 10e6, address(weth), 0);
        vault.deposit(address(usdc), 10e6);

        vm.expectEmit(true, false, false, true, address(vault));
        emit Vault.Withdrawn(address(usdc), 10e6, USER);
        vm.expectEmit(false, false, false, true, address(vault));
        emit Vault.Balances(address(usdc), 0, address(weth), 0);
        vault.withdraw(address(usdc), 10e6, USER);
        vm.stopPrank();
    }

    function test_withdrawCannotExceedPrincipal() public {
        _fund(10e6);
        vm.prank(USER);
        vm.expectRevert();
        vault.withdraw(address(usdc), 20e6, USER);
    }

    function test_setPayoutAddressIsOwnerOnly() public {
        vm.prank(USER);
        vault.setPayoutAddress(address(0xFEED));
        assertEq(vault.payoutAddress(), address(0xFEED));

        vm.prank(address(0xB0B));
        vm.expectRevert(NotOwner.selector);
        vault.setPayoutAddress(address(0xB0B));
    }

    function _deployVault(
        address owner_,
        address agent_,
        address tokenIn_,
        address tokenOut_,
        uint256 cap_,
        address router_
    ) internal returns (Vault deployed) {
        deployed = new Vault(
            IPayable(payable(address(proxy))),
            owner_,
            agent_,
            router_,
            tokenIn_,
            tokenOut_,
            cap_,
            false
        );
    }

    function test_constructorValidatesEveryArgument() public {
        vm.expectRevert(InvalidTemplateParams.selector);
        _deployVault(address(0), AGENT, address(usdc), address(weth), 1, address(0x1234));

        vm.expectRevert(InvalidTemplateParams.selector);
        _deployVault(USER, address(0), address(usdc), address(weth), 1, address(0x1234));

        vm.expectRevert(InvalidTemplateParams.selector);
        _deployVault(USER, AGENT, address(usdc), address(weth), 1, address(0));

        vm.expectRevert(InvalidTemplateParams.selector);
        _deployVault(USER, AGENT, address(0), address(weth), 1, address(0x1234));

        vm.expectRevert(
            abi.encodeWithSelector(TokenMismatch.selector, address(usdc), address(usdc))
        );
        _deployVault(USER, AGENT, address(usdc), address(usdc), 1, address(0x1234));

        vm.expectRevert(InvalidAmount.selector);
        _deployVault(USER, AGENT, address(usdc), address(weth), 0, address(0x1234));
    }

    function test_depositRejectsZeroTokenOrAmount() public {
        vm.startPrank(USER);
        vm.expectRevert(InvalidAmount.selector);
        vault.deposit(address(0), 1);
        vm.expectRevert(InvalidAmount.selector);
        vault.deposit(address(usdc), 0);
        vm.stopPrank();
    }

    function test_setLimitsRejectsZeroCap() public {
        vm.prank(USER);
        vm.expectRevert(InvalidAmount.selector);
        vault.setLimits(0, address(usdc), address(weth));
    }

    function test_setPayoutAddressRejectsZero() public {
        vm.prank(USER);
        vm.expectRevert(InvalidTemplateParams.selector);
        vault.setPayoutAddress(address(0));
    }

    function test_withdrawFallsBackToThePayoutAddress() public {
        _fund(10e6);
        vm.startPrank(USER);
        vault.setPayoutAddress(address(0xFEED));
        vault.withdraw(address(usdc), 10e6, address(0));
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(0xFEED)), 10e6);
    }

    function test_withdrawPartialKeepsRemainingPrincipal() public {
        _fund(10e6);
        vm.prank(USER);
        vault.withdraw(address(usdc), 4e6, USER);
        assertEq(usdc.balanceOf(USER), 4e6);
        assertEq(vault.principalOf(address(usdc)), 6e6);
        assertEq(usdc.balanceOf(address(vault)), 6e6);
    }

    function test_executeValidatesPayloadBeforeDoingAnything() public {
        vm.prank(address(proxy));
        vm.expectRevert(InvalidTemplateParams.selector);
        vault.execute(address(agentRegistry), 1, "");

        bytes memory unknownTemplate =
            abi.encode(uint16(14), address(usdc), uint256(0), uint256(0), uint64(0), uint256(0));
        vm.prank(address(proxy));
        vm.expectRevert(abi.encodeWithSelector(UnknownTemplate.selector, 14));
        vault.execute(address(agentRegistry), 1, unknownTemplate);

        bytes memory validPayload = abi.encode(
            uint16(1), address(usdc), uint256(0), uint256(50), uint64(type(uint64).max), uint256(0)
        );
        vm.prank(address(proxy));
        vm.expectRevert(ConditionNotMet.selector);
        vault.execute(address(agentRegistry), 1, validPayload);

        vm.prank(address(proxy));
        vm.expectRevert(InvalidTemplateParams.selector);
        vault.execute(address(agentRegistry), uint256(type(uint32).max) + 1, validPayload);
    }

    function test_vaultAcceptsEthForCallbackGas() public {
        (bool ok,) = address(vault).call{value: 1 wei}("");
        assertTrue(ok);
        assertEq(address(vault).balance, 1 wei);
    }
}

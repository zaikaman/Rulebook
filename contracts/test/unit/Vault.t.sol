// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {PriceMath} from "../../src/libraries/PriceMath.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {
    AlertOnlyTemplate,
    CallbackSenderMismatch,
    ConditionNotMet,
    ExceedsPerRunCap,
    Expired,
    InsufficientPrincipal,
    InvalidAmount,
    InvalidCallbackPayload,
    InvalidTemplateParams,
    NotOwner,
    NotServiceProvider,
    SlippageExceeded,
    TokenMismatch,
    TransferFailed,
    UnknownTemplate
} from "../../src/shared/Errors.sol";
import {MockAgentVaultRegistry} from "../mocks/MockAgentVaultRegistry.sol";
import {MockCallbackProxy} from "../mocks/MockCallbackProxy.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";

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

    function test_executeDoesNotReadAgentStateAcrossChains() public {
        // The Vault never consults the Lasna Agent: a transfer still runs when the mock registry
        // reports that no vault is linked.
        agentRegistry.setLinkedVault(address(0));
        _fund(10e6);
        bytes memory validPayload = abi.encode(
            uint16(7),
            address(0),
            uint256(0),
            uint256(5e6),
            uint64(0),
            uint256(uint160(address(0xB0B)))
        );
        vm.prank(address(proxy));
        vault.execute(address(agentRegistry), 1, validPayload);
        assertEq(usdc.balanceOf(address(0xB0B)), 5e6);
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
        vm.expectRevert(InvalidCallbackPayload.selector);
        vault.execute(address(agentRegistry), 1, "");

        bytes memory unknownTemplate =
            abi.encode(uint16(14), address(usdc), uint256(0), uint256(1), uint64(0), uint256(0));
        vm.prank(address(proxy));
        vm.expectRevert(abi.encodeWithSelector(UnknownTemplate.selector, 14));
        vault.execute(address(agentRegistry), 1, unknownTemplate);

        bytes memory alertPayload =
            abi.encode(uint16(11), address(usdc), uint256(1), uint256(0), uint64(0), uint256(0));
        vm.prank(address(proxy));
        vm.expectRevert(abi.encodeWithSelector(AlertOnlyTemplate.selector, 11));
        vault.execute(address(agentRegistry), 1, alertPayload);

        bytes memory validPayload = abi.encode(
            uint16(7),
            address(0),
            uint256(0),
            uint256(1),
            uint64(0),
            uint256(uint160(address(0xB0B)))
        );
        vm.prank(address(proxy));
        vm.expectRevert(abi.encodeWithSelector(InsufficientPrincipal.selector, 1, 0));
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

/// @notice US5 money path: transfers, the balance-floor pull, alert refusal, and quote-at-
/// execution from live reserves (T170–T174).
contract VaultExecutionTest is Test {
    address internal constant USER = address(0xA11CE);
    address internal constant AGENT = address(0x00000000000000000000000000000000000a6E47);
    address internal constant SOURCE = address(0xCAFE);
    address internal constant RECIPIENT = address(0xBEEF);
    address internal constant STRANGER = address(0xB0B);

    uint256 internal constant CAP = 100e6;

    MockCallbackProxy internal proxy;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockPair internal pair;
    MockRouter internal router;
    Vault internal vault;

    function setUp() public {
        proxy = new MockCallbackProxy();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pair = new MockPair(address(usdc), address(weth));
        router = new MockRouter();
        vault = new Vault(
            IPayable(payable(address(proxy))),
            USER,
            AGENT,
            address(router),
            address(usdc),
            address(weth),
            CAP,
            false
        );
        usdc.mint(USER, 50e6);
        vm.startPrank(USER);
        usdc.approve(address(vault), 50e6);
        vault.deposit(address(usdc), 50e6);
        vm.stopPrank();
        weth.mint(address(router), 100e18);
    }

    function _payload(
        uint16 template,
        address pair_,
        uint256 threshold,
        uint256 amountIn,
        uint64 expiry,
        uint256 extra
    ) internal pure returns (bytes memory) {
        return abi.encode(template, pair_, threshold, amountIn, expiry, extra);
    }

    function _execute(uint256 ruleId, bytes memory data) internal {
        vm.prank(address(proxy));
        vault.execute(AGENT, ruleId, data);
    }

    function _setPrice(uint256 priceWad) internal {
        pair.setReserves(uint112(1e18), uint112(priceWad));
    }

    // --- T170: the transfer path -----------------------------------------------------------

    function test_transferTemplateSendsTokensAndEmitsBalances() public {
        bytes memory data = _payload(7, address(0), 0, 5e6, 0, uint256(uint160(RECIPIENT)));

        vm.expectEmit(true, false, false, true, address(vault));
        emit Vault.Executed(7, address(usdc), address(0), 5e6, 0, block.timestamp);
        vm.expectEmit(false, false, false, true, address(vault));
        emit Vault.Balances(address(usdc), 45e6, address(weth), 0);
        _execute(7, data);

        assertEq(usdc.balanceOf(RECIPIENT), 5e6);
        assertEq(vault.principalOf(address(usdc)), 45e6);
    }

    function test_balanceFloorPullsFromTheApprovedWallet() public {
        usdc.mint(SOURCE, 100e6);
        vm.prank(SOURCE);
        usdc.approve(address(vault), 100e6);

        bytes memory data = _payload(9, address(0), 40e6, 10e6, 0, uint256(uint160(SOURCE)));
        vm.expectEmit(true, false, false, true, address(vault));
        emit Vault.Deposited(address(usdc), 10e6, SOURCE);
        _execute(9, data);

        assertEq(usdc.balanceOf(address(vault)), 60e6);
        assertEq(vault.principalOf(address(usdc)), 60e6);
    }

    function test_pullWithoutAllowanceSurfacesAsTransferFailed() public {
        bytes memory data = _payload(9, address(0), 40e6, 10e6, 0, uint256(uint160(SOURCE)));
        vm.prank(address(proxy));
        vm.expectRevert(TransferFailed.selector);
        vault.execute(AGENT, 9, data);
    }

    function test_transferBeyondThePrincipalIsRefused() public {
        bytes memory data = _payload(7, address(0), 0, 90e6, 0, uint256(uint160(RECIPIENT)));
        vm.prank(address(proxy));
        vm.expectRevert(abi.encodeWithSelector(InsufficientPrincipal.selector, 90e6, 50e6));
        vault.execute(AGENT, 7, data);
    }

    // --- T172: alert templates move nothing ------------------------------------------------

    function test_alertTemplatesNeverReachATokenTransfer() public {
        bytes memory data = _payload(13, address(0), 1, 0, 0, 0);
        vm.prank(address(proxy));
        vm.expectRevert(abi.encodeWithSelector(AlertOnlyTemplate.selector, 13));
        vault.execute(AGENT, 13, data);
        assertEq(usdc.balanceOf(address(vault)), 50e6);
    }

    // --- T174: quote at execution ----------------------------------------------------------

    function test_amountOutMinComesFromLiveReserves() public {
        _setPrice(2e18);
        uint256 expected = PriceMath.expectedOut(10e6, 1e18, 2e18);
        uint256 liveMin = PriceMath.applySlippage(expected, vault.slippageBps());

        _execute(1, _payload(1, address(pair), 0, 10e6, 0, 0));

        (, uint256 amountOutMin,,) = router.lastSwap();
        assertEq(router.swapCount(), 1);
        assertEq(amountOutMin, liveMin);
        assertEq(weth.balanceOf(address(vault)), liveMin);
    }

    function test_aReserveMoveBetweenDecisionAndExecutionReverts() public {
        _setPrice(2e18);
        uint256 decisionFloor = PriceMath.expectedOut(10e6, 1e18, 2e18);
        _setPrice(0.5e18);
        uint256 liveExpected = PriceMath.expectedOut(10e6, 1e18, 0.5e18);

        bytes memory data = _payload(1, address(pair), 0, 10e6, 0, decisionFloor);
        vm.prank(address(proxy));
        vm.expectRevert(
            abi.encodeWithSelector(SlippageExceeded.selector, decisionFloor, liveExpected)
        );
        vault.execute(AGENT, 1, data);
    }

    function test_theFundsSideRechecksThePriceCondition() public {
        _setPrice(2e18);
        bytes memory data = _payload(3, address(pair), 1e18, 10e6, 0, 0);
        vm.prank(address(proxy));
        vm.expectRevert(ConditionNotMet.selector);
        vault.execute(AGENT, 3, data);
    }

    function test_aLimitBuyAfterExpiryReverts() public {
        vm.warp(10_000);
        _setPrice(1e18);
        uint64 expiry = uint64(block.timestamp - 1);
        bytes memory data = _payload(3, address(pair), 2e18, 10e6, expiry, 0);
        vm.prank(address(proxy));
        vm.expectRevert(abi.encodeWithSelector(Expired.selector, 3, expiry));
        vault.execute(AGENT, 3, data);
    }

    function test_amountAboveThePerRunCeilingReverts() public {
        bytes memory data = _payload(7, address(0), 0, CAP + 1, 0, uint256(uint160(RECIPIENT)));
        vm.prank(address(proxy));
        vm.expectRevert(abi.encodeWithSelector(ExceedsPerRunCap.selector, CAP + 1, CAP));
        vault.execute(AGENT, 7, data);
    }

    function test_aPairForAnotherTokenSetIsRefused() public {
        MockPair other = new MockPair(address(weth), address(STRANGER));
        bytes memory data = _payload(1, address(other), 0, 10e6, 0, 0);
        vm.prank(address(proxy));
        vm.expectRevert();
        vault.execute(AGENT, 1, data);
    }
}

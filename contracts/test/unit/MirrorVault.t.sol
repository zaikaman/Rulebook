// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {Vault} from "../../src/vault/Vault.sol";
import {MirrorVault} from "../../src/vault/MirrorVault.sol";
import {MirrorPayload} from "../../src/shared/CallbackPayload.sol";
import {
    CallbackSenderMismatch,
    ConditionNotMet,
    DuplicateLeaderExecution,
    ExceedsPerRunCap,
    InsufficientPrincipal,
    InvalidAmount,
    InvalidCallbackPayload,
    MirrorDepthNotAllowed,
    NotServiceProvider,
    SlippageExceeded,
    TokenMismatch
} from "../../src/shared/Errors.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPair} from "../mocks/MockPair.sol";
import {MockRouter} from "../mocks/MockRouter.sol";

contract MirrorVaultTest is Test {
    address internal constant PROXY = address(0x1234);
    address internal constant AGENT = address(0x1235);
    address internal constant LEADER = address(0x1236);
    bytes32 internal constant LEADER_TX = bytes32(uint256(1));

    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    MockPair internal pair;
    MockRouter internal router;
    Vault internal mirror;

    function setUp() public {
        tokenIn = new MockERC20("USD", "USD", 6);
        tokenOut = new MockERC20("Token", "TOK", 18);
        pair = new MockPair(address(tokenIn), address(tokenOut));
        pair.setReserves(100e6, 100e18);
        router = new MockRouter();
        router.setPair(address(pair));
        mirror = new MirrorVault(
            IPayable(payable(PROXY)),
            address(this),
            AGENT,
            address(router),
            address(tokenIn),
            address(tokenOut),
            100e6
        );
        tokenIn.mint(address(this), 20e6);
        tokenIn.approve(address(mirror), 20e6);
        mirror.deposit(address(tokenIn), 20e6);
        tokenOut.mint(address(router), 100e18);
    }

    function test_mirrorEmitsMirroredAndNeverExecuted() public {
        vm.recordLogs();
        vm.prank(PROXY);
        mirror.executeMirror(AGENT, 0, _payload(1e18));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool sawMirror;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(mirror)) continue;
            assertNotEq(logs[i].topics[0], Vault.Executed.selector);
            if (logs[i].topics[0] == Vault.Mirrored.selector) {
                sawMirror = true;
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(LEADER))));
                assertEq(abi.decode(logs[i].data, (bytes32)), LEADER_TX);
            }
        }
        assertTrue(sawMirror);
        assertTrue(mirror.mirrorMode());
        assertEq(mirror.principalOf(address(tokenIn)), 15e6);
    }

    function test_onlyProxyAndBoundAgentCanExecuteMirror() public {
        vm.expectRevert(NotServiceProvider.selector);
        mirror.executeMirror(AGENT, 0, _payload(1e18));
        vm.prank(PROXY);
        vm.expectRevert(abi.encodeWithSelector(CallbackSenderMismatch.selector, AGENT, LEADER));
        mirror.executeMirror(LEADER, 0, _payload(1e18));
    }

    function test_mirrorRefusesOrdinaryPayloadAndLeaderRefusesMirrorPayload() public {
        vm.prank(PROXY);
        vm.expectRevert(MirrorDepthNotAllowed.selector);
        mirror.execute(AGENT, 0, "");
        Vault leader = new Vault(
            IPayable(payable(PROXY)),
            address(this),
            AGENT,
            address(router),
            address(tokenIn),
            address(tokenOut),
            100e6,
            false
        );
        vm.prank(PROXY);
        vm.expectRevert(MirrorDepthNotAllowed.selector);
        leader.executeMirror(AGENT, 0, _payload(1e18));
    }

    function test_unacceptableLiveOutputLeavesPrincipalUntouched() public {
        vm.prank(PROXY);
        vm.expectPartialRevert(SlippageExceeded.selector);
        mirror.executeMirror(AGENT, 0, _payload(10e18));
        assertEq(router.swapCount(), 0);
        assertEq(mirror.principalOf(address(tokenIn)), 20e6);
    }

    function test_refusesPausedOrMalformedCallbacks() public {
        mirror.setPaused(true);
        _refused(ConditionNotMet.selector, _payload(1e18));
        mirror.setPaused(false);
        _refused(InvalidCallbackPayload.selector, "");
    }

    function test_refusesAZeroOrSelfLeader() public {
        MirrorPayload memory payload = _mirrorPayload(1e18);
        payload.leaderVault = address(0);
        _refused(MirrorDepthNotAllowed.selector, abi.encode(payload));
        payload.leaderVault = address(mirror);
        _refused(MirrorDepthNotAllowed.selector, abi.encode(payload));
    }

    function test_refusesEitherMismatchedToken() public {
        MirrorPayload memory payload = _mirrorPayload(1e18);
        payload.tokenIn = LEADER;
        _refused(TokenMismatch.selector, abi.encode(payload));
        payload.tokenIn = address(tokenIn);
        payload.tokenOut = LEADER;
        _refused(TokenMismatch.selector, abi.encode(payload));
    }

    function test_checksTheAmountAndPrincipalBeforeTrading() public {
        MirrorPayload memory payload = _mirrorPayload(0);
        _refused(InvalidAmount.selector, abi.encode(payload));
        payload.minOut = 1e18;
        payload.amountIn = 0;
        _refused(InvalidAmount.selector, abi.encode(payload));
        payload.amountIn = 101e6;
        _refused(ExceedsPerRunCap.selector, abi.encode(payload));
        payload.amountIn = 21e6;
        _refused(InsufficientPrincipal.selector, abi.encode(payload));
    }

    function test_vaultRejectsRepeatedDeliveryEvenWithADifferentFollowerRuleId() public {
        vm.prank(PROXY);
        mirror.executeMirror(AGENT, 1, _payload(1e18));
        _refused(DuplicateLeaderExecution.selector, _payload(1e18));
        assertEq(router.swapCount(), 1);
    }

    function test_followerFloorIsPassedToRouterAndCheckedAgainstReceivedTokens() public {
        uint256 floor = 4.74e18;
        uint256[] memory amounts = new uint256[](2);
        vm.mockCall(
            address(router),
            abi.encodePacked(MockRouter.swapExactTokensForTokens.selector),
            abi.encode(amounts)
        );
        _refused(SlippageExceeded.selector, _payload(floor));
        vm.clearMockedCalls();
        vm.prank(PROXY);
        mirror.executeMirror(AGENT, 0, _payload(floor));
        (, uint256 routerMinimum,,) = router.lastSwap();
        assertEq(routerMinimum, floor);
    }

    function _refused(bytes4 selector, bytes memory payload) private {
        vm.prank(PROXY);
        vm.expectPartialRevert(selector);
        mirror.executeMirror(AGENT, 0, payload);
    }

    function _payload(uint256 minOut) private view returns (bytes memory) {
        return abi.encode(_mirrorPayload(minOut));
    }

    function _mirrorPayload(uint256 minOut) private view returns (MirrorPayload memory) {
        return MirrorPayload(
            address(pair),
            address(tokenIn),
            address(tokenOut),
            5e6,
            minOut,
            LEADER,
            LEADER_TX,
            uint256(0)
        );
    }
}

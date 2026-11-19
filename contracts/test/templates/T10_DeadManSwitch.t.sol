// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IPayable} from "@reactive/interfaces/IPayable.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

import {Agent} from "../../src/agent/Agent.sol";
import {AgentFactory} from "../../src/agent/AgentFactory.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {IRuleRegistry} from "../../src/registry/IRuleRegistry.sol";
import {StaleExecution} from "../../src/shared/Errors.sol";
import {CallbackConfiguration} from "../../src/shared/ReactiveTypes.sol";
import {Vault} from "../../src/vault/Vault.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 10 — dead-man switch: after inactivity, send on the next tick.
contract T10_DeadManSwitchTest is TemplateTestBase {
    address internal constant RECIPIENT = address(0xBEEF);
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 10;
        rule.chainId = uint16(CHAIN);
        rule.pair = RECIPIENT;
        rule.tokenIn = address(usdc);
        rule.amountIn = 10e6;
        rule.threshold = 1 hours; // schedule
        rule.secondary = 30; // inactivity days
    }

    function test_firesAfterTheInactivityPeriod() public {
        vm.warp(block.timestamp + 31 days);
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);
    }

    function test_doesNotFireBeforeTheInactivityPeriod() public {
        vm.warp(block.timestamp + 10 days);
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }

    function test_dailyTimerSettlesThePayoutOnlyOnceAtTheInactivityBoundary() public {
        AgentFactory factory = new AgentFactory(system, IRuleRegistry(address(0)));
        agent = Agent(factory.deploy(USER));
        address proxy = makeAddr("destination callback proxy");
        Vault vault = new Vault(
            IPayable(payable(proxy)),
            USER,
            address(agent),
            address(pair),
            address(usdc),
            address(weth),
            100e6,
            false
        );
        vm.prank(USER);
        agent.linkVault(CHAIN, address(vault));
        RuleLib.Rule memory rule = _rule();
        rule.threshold = 1 days;
        rule.secondary = 1;
        ruleId = _add(rule);

        usdc.mint(address(this), rule.amountIn);
        usdc.approve(address(vault), rule.amountIn);
        vault.deposit(address(usdc), rule.amountIn);

        uint256 eligibleAt = uint256(agent.lastActivity()) + 1 days;
        vm.warp(eligibleAt - 1);
        _react(_tick(DAILY_CRON_TOPIC));
        assertEq(_requestCount(), 0);

        vm.warp(eligibleAt);
        IReactive.LogRecord memory tick = _tick(DAILY_CRON_TOPIC);
        _react(tick);
        _react(tick);
        assertEq(_requestCount(), 1);

        CallbackConfiguration memory request = system.requestAt(0);
        assertEq(request.chainId, CHAIN);
        assertEq(request.recipient, address(vault));
        bytes memory payout = request.payload;
        address sender = address(agent);
        assembly ("memory-safe") {
            mstore(add(payout, 36), sender)
        }
        vm.expectEmit(true, false, false, true, address(vault));
        emit Vault.Executed(ruleId, address(usdc), address(0), rule.amountIn, 0, eligibleAt);
        vm.prank(proxy);
        (bool settled,) = address(vault).call{gas: request.gasLimit}(payout);
        assertTrue(settled, "the scheduled payout must settle");
        assertEq(usdc.balanceOf(RECIPIENT), rule.amountIn);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(vault.principalOf(address(usdc)), 0);

        vm.prank(proxy);
        (bool replayed, bytes memory errorData) = address(vault).call(payout);
        assertFalse(replayed);
        assertEq(errorData, abi.encodeWithSelector(StaleExecution.selector, ruleId, uint32(1)));
        assertEq(usdc.balanceOf(RECIPIENT), rule.amountIn);
    }

    function test_ownersOwnTransferResetsTheClock() public {
        vm.warp(block.timestamp + 20 days);
        _react(_transferLog(address(usdc), USER, STRANGER, 1e6));
        vm.warp(block.timestamp + 20 days);
        _react(_tick(HOURLY_CRON_TOPIC));
        assertEq(_runs(ruleId), 0, "the clock restarts at the owner's last activity");
    }
}

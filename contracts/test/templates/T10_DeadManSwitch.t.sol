// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

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
        _react(_tick());
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);
    }

    function test_doesNotFireBeforeTheInactivityPeriod() public {
        vm.warp(block.timestamp + 10 days);
        _react(_tick());
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }

    function test_ownersOwnTransferResetsTheClock() public {
        vm.warp(block.timestamp + 20 days);
        _react(_transferLog(address(usdc), USER, STRANGER, 1e6));
        vm.warp(block.timestamp + 20 days);
        _react(_tick());
        assertEq(_runs(ruleId), 0, "the clock restarts at the owner's last activity");
    }
}

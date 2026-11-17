// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 12 — range alert: alert when the price leaves `threshold`..`secondary`.
contract T12_RangeAlertTest is TemplateTestBase {
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 12;
        rule.chainId = uint16(CHAIN);
        rule.pair = address(pair);
        rule.threshold = 1e18; // low edge
        rule.secondary = 3e18; // high edge
    }

    function test_alertsAboveTheRange() public {
        uint256 alerts = _reactAndCountAlerts(_syncPrice(3.5e18));
        assertEq(_runs(ruleId), 1);
        assertEq(alerts, 1);
        assertEq(_requestCount(), 0);
    }

    function test_alertsBelowTheRange() public {
        uint256 alerts = _reactAndCountAlerts(_syncPrice(0.5e18));
        assertEq(_runs(ruleId), 1);
        assertEq(alerts, 1);
    }

    function test_staysSilentInsideTheRange() public {
        uint256 alerts = _reactAndCountAlerts(_syncPrice(2e18));
        assertEq(_runs(ruleId), 0);
        assertEq(alerts, 0);
    }
}

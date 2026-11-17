// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 11 — price alert: one alert record, zero token movement.
contract T11_PriceAlertTest is TemplateTestBase {
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 11;
        rule.chainId = uint16(CHAIN);
        rule.pair = address(pair);
        rule.threshold = 2e18;
    }

    function test_alertsWithoutMovingAnyFunds() public {
        uint256 alerts = _reactAndCountAlerts(_syncPrice(2.5e18));
        assertEq(_runs(ruleId), 1);
        assertEq(alerts, 1, "one alert record");
        assertEq(_requestCount(), 0, "an alert never requests a callback");
    }

    function test_staysSilentBelowTheThreshold() public {
        uint256 alerts = _reactAndCountAlerts(_syncPrice(1.9e18));
        assertEq(_runs(ruleId), 0);
        assertEq(alerts, 0);
    }

    function test_doesNotAlertTwiceWithoutAReset() public {
        _react(_syncPrice(2.5e18));
        _react(_syncPrice(3e18));
        assertEq(_runs(ruleId), 1, "a fired alert latches");
        assertEq(_requestCount(), 0);
    }
}

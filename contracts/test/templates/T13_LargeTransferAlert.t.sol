// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 13 — large-transfer alert: one alert when a transfer exceeds the threshold.
contract T13_LargeTransferAlertTest is TemplateTestBase {
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        _linkVault();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 13;
        rule.chainId = uint16(CHAIN);
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.threshold = 100e6;
    }

    function test_alertsAboveTheThreshold() public {
        uint256 alerts = _reactAndCountAlerts(_transferLog(address(usdc), STRANGER, VAULT, 101e6));
        assertEq(_runs(ruleId), 1);
        assertEq(alerts, 1);
        assertEq(_requestCount(), 0, "an alert never moves funds");
    }

    function test_staysSilentAtTheThresholdBoundary() public {
        uint256 alerts = _reactAndCountAlerts(_transferLog(address(usdc), STRANGER, VAULT, 100e6));
        assertEq(_runs(ruleId), 0, "the threshold is exclusive");
        assertEq(alerts, 0);
    }

    function test_ignoresTransfersToAnotherAddress() public {
        uint256 alerts = _reactAndCountAlerts(_transferLog(address(usdc), STRANGER, USER, 500e6));
        assertEq(_runs(ruleId), 0);
        assertEq(alerts, 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 8 — income sweep: an incoming transfer to the vault triggers a send.
contract T08_IncomeSweepTest is TemplateTestBase {
    address internal constant RECIPIENT = address(0xBEEF);
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        _linkVault();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 8;
        rule.chainId = uint16(CHAIN);
        rule.pair = RECIPIENT;
        rule.tokenIn = address(usdc);
        rule.amountIn = 10e6;
        rule.threshold = 50e6; // minimum incoming amount
    }

    function test_firesOnAnIncomingTransferAtOrAboveTheThreshold() public {
        _react(_transferLog(address(usdc), STRANGER, VAULT, 60e6));
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);
    }

    function test_doesNotFireBelowTheThreshold() public {
        _react(_transferLog(address(usdc), STRANGER, VAULT, 49e6));
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }

    function test_ignoresTransfersAddressedElsewhere() public {
        _react(_transferLog(address(usdc), STRANGER, STRANGER, 60e6));
        assertEq(_runs(ruleId), 0);
    }
}

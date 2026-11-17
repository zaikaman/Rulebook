// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice SC-008: a hundred identical trigger events produce exactly one funds movement for a
/// non-cron rule.
contract LatchInvariantTest is TemplateTestBase {
    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 3;
        rule.chainId = uint16(CHAIN);
        rule.pair = address(pair);
        rule.tokenIn = address(usdc);
        rule.tokenOut = address(weth);
        rule.amountIn = 10e6;
        rule.threshold = 1.5e18;
        rule.secondary = block.timestamp + 30 days;
    }

    function test_hundredIdenticalTriggersMoveFundsOnce() public {
        uint256 ruleId = _add(_rule());
        for (uint256 i = 0; i < 100; ++i) {
            _react(_syncPrice(1e18));
        }
        assertEq(_runs(ruleId), 1, "one execution across one hundred events");
        assertEq(_requestCount(), 1, "one funds-side callback");
    }
}

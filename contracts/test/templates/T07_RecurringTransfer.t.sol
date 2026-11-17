// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {ExecutionPayload} from "../../src/shared/CallbackPayload.sol";
import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 7 — recurring transfer: every schedule, send tokenIn to the recipient.
contract T07_RecurringTransferTest is TemplateTestBase {
    address internal constant RECIPIENT = address(0xBEEF);
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 7;
        rule.chainId = uint16(CHAIN);
        rule.pair = RECIPIENT; // the encoder stores the recipient in `pair`
        rule.tokenIn = address(usdc);
        rule.amountIn = 10e6;
        rule.secondary = 1 days; // schedule
    }

    function test_firesOnADueCronTickAndNamesTheRecipient() public {
        _react(_tick());
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);

        ExecutionPayload memory payload = _decodedRequest(0);
        assertEq(payload.template, 7);
        assertEq(address(uint160(payload.extra)), RECIPIENT);
        assertEq(payload.amountIn, 10e6);
    }

    function test_doesNotFireBeforeTheWindow() public {
        _react(_tick());
        _react(_tick());
        assertEq(_runs(ruleId), 1);
    }

    function test_doesNotFireOnAPriceSync() public {
        _react(_syncPrice(2e18));
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }

    function _decodedRequest(uint256 index)
        internal
        view
        returns (ExecutionPayload memory payload)
    {
        bytes memory full = system.requestAt(index).payload;
        bytes memory args = new bytes(full.length - 4);
        for (uint256 i = 0; i < args.length; ++i) {
            args[i] = full[i + 4];
        }
        (,, bytes memory inner) = abi.decode(args, (address, uint256, bytes));
        (payload.template, payload.pair, payload.threshold, payload.amountIn, payload.expiry, payload
            .extra) = abi.decode(inner, (uint16, address, uint256, uint256, uint64, uint256));
    }
}

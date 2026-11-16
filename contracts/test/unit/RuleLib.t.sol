// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

import {RuleLib} from "../../src/libraries/RuleLib.sol";
import {
    InvalidAmount,
    InvalidSecondary,
    InvalidTemplateParams,
    InvalidThreshold,
    UnknownTemplate,
    UnsupportedChain
} from "../../src/shared/Errors.sol";

contract RuleLibHarness {
    function validate(RuleLib.Rule memory rule) external pure {
        RuleLib.validate(rule);
    }
}

contract RuleLibTest is Test {
    address internal constant USDC = address(0xAA);
    address internal constant WETH = address(0xBB);
    address internal constant PAIR = address(0xCC);

    RuleLibHarness internal harness;

    function setUp() public {
        harness = new RuleLibHarness();
    }

    function _rule(uint8 template) internal pure returns (RuleLib.Rule memory rule) {
        rule.template = template;
        rule.chainId = 1301;
        rule.flags = RuleLib.FLAG_ACTIVE;
        rule.pair = PAIR;
        rule.tokenIn = USDC;
        rule.tokenOut = WETH;
        rule.amountIn = 10e6;
        rule.threshold = 1_500e18;
        rule.secondary = 500;
    }

    function test_packUnpackRoundTrip() public pure {
        RuleLib.Rule memory rule = _rule(3);
        rule.lastRun = 1_700_000_000;
        rule.runs = 7;
        rule.flags = RuleLib.FLAG_ACTIVE | RuleLib.FLAG_LATCHED;
        bytes32[8] memory slots = RuleLib.pack(rule);
        RuleLib.Rule memory decoded = RuleLib.unpack(slots);
        assertEq(keccak256(abi.encode(decoded)), keccak256(abi.encode(rule)));
    }

    function test_packUsesEightSlots() public pure {
        bytes32[8] memory slots = RuleLib.pack(_rule(1));
        assertEq(slots[0] != bytes32(0), true);
        assertEq(uint8(uint256(slots[0])), 1);
        assertEq(uint16(uint256(slots[0]) >> 8), 1301);
    }

    function test_validateRejectsUnknownTemplate() public {
        vm.expectRevert(abi.encodeWithSelector(UnknownTemplate.selector, 14));
        harness.validate(_rule(14));
    }

    function test_validateRejectsUnsupportedChain() public {
        RuleLib.Rule memory rule = _rule(1);
        rule.chainId = 999;
        vm.expectRevert(abi.encodeWithSelector(UnsupportedChain.selector, 999));
        harness.validate(rule);
    }

    function test_validateRejectsZeroAmountForMoneyTemplate() public {
        RuleLib.Rule memory rule = _rule(1);
        rule.amountIn = 0;
        vm.expectRevert(InvalidAmount.selector);
        harness.validate(rule);
    }

    function test_validateRejectsAmountForAlertTemplate() public {
        RuleLib.Rule memory rule = _rule(11);
        rule.tokenOut = address(0);
        vm.expectRevert(InvalidAmount.selector);
        harness.validate(rule);
    }

    function test_validateAcceptsAlertTemplateWithoutFunds() public pure {
        RuleLib.Rule memory rule = _rule(11);
        rule.amountIn = 0;
        rule.tokenOut = address(0);
        RuleLib.validate(rule);
    }

    function test_validateRejectsZeroThreshold() public {
        RuleLib.Rule memory rule = _rule(4);
        rule.threshold = 0;
        vm.expectRevert(InvalidThreshold.selector);
        harness.validate(rule);
    }

    function test_validateRejectsMissingPairForPriceTemplate() public {
        RuleLib.Rule memory rule = _rule(4);
        rule.pair = address(0);
        vm.expectRevert(InvalidTemplateParams.selector);
        harness.validate(rule);
    }

    function test_validateRejectsMissingTokenOutForSwapTemplate() public {
        RuleLib.Rule memory rule = _rule(1);
        rule.tokenOut = address(0);
        vm.expectRevert(InvalidTemplateParams.selector);
        harness.validate(rule);
    }

    function test_validateRejectsSameTokenInAndOut() public {
        RuleLib.Rule memory rule = _rule(1);
        rule.tokenOut = USDC;
        vm.expectRevert(InvalidTemplateParams.selector);
        harness.validate(rule);
    }

    function test_validateRejectsTrailingAbove10000Bps() public {
        RuleLib.Rule memory rule = _rule(5);
        rule.secondary = 10_001;
        vm.expectRevert(InvalidSecondary.selector);
        harness.validate(rule);
    }

    function test_validateRejectsMissingExpiry() public {
        RuleLib.Rule memory rule = _rule(3);
        rule.secondary = 0;
        vm.expectRevert(InvalidSecondary.selector);
        harness.validate(rule);
    }

    function test_validateEnforcesInactivityDayBounds() public {
        RuleLib.Rule memory rule = _rule(10);
        rule.secondary = 0;
        vm.expectRevert(InvalidSecondary.selector);
        harness.validate(rule);

        rule.secondary = 366;
        vm.expectRevert(InvalidSecondary.selector);
        harness.validate(rule);

        rule.secondary = 365;
        harness.validate(rule);
    }

    function test_paramsHashIgnoresRuntimeState() public pure {
        RuleLib.Rule memory rule = _rule(1);
        bytes32 first = RuleLib.paramsHash(rule);
        rule.lastRun = 42;
        rule.runs = 9;
        rule.flags = RuleLib.FLAG_LATCHED;
        assertEq(RuleLib.paramsHash(rule), first);
    }

    function test_paramsHashChangesWithAParameter() public pure {
        RuleLib.Rule memory rule = _rule(1);
        bytes32 first = RuleLib.paramsHash(rule);
        rule.amountIn = 11e6;
        assertTrue(RuleLib.paramsHash(rule) != first);
    }
}

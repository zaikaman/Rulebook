// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {RuleLib} from "../../src/libraries/RuleLib.sol";

import {TemplateTestBase} from "./TemplateTestBase.sol";

/// @notice Template 9 — balance floor: the Vault's own `Balances` event drives a pull.
contract T09_BalanceFloorTest is TemplateTestBase {
    address internal constant SOURCE = address(0xCAFE);
    uint256 internal ruleId;

    function setUp() public override {
        super.setUp();
        _linkVault();
        ruleId = _add(_rule());
    }

    function _rule() internal view returns (RuleLib.Rule memory rule) {
        rule.template = 9;
        rule.chainId = uint16(CHAIN);
        rule.pair = SOURCE; // the approved wallet the Vault pulls from
        rule.tokenIn = address(usdc);
        rule.amountIn = 100e6;
        rule.threshold = 40e6; // floor
    }

    function test_firesWhenTheVaultBalanceFallsBelowTheFloor() public {
        _react(_balancesLog(VAULT, address(usdc), 39e6));
        assertEq(_runs(ruleId), 1);
        assertEq(_requestCount(), 1);
    }

    function test_doesNotFireAtOrAboveTheFloor() public {
        _react(_balancesLog(VAULT, address(usdc), 40e6));
        assertEq(_runs(ruleId), 0);
        assertEq(_requestCount(), 0);
    }

    function test_ignoresBalancesFromAnotherContract() public {
        _react(_balancesLog(address(0xDEAD), address(usdc), 1e6));
        assertEq(_runs(ruleId), 0);
    }
}

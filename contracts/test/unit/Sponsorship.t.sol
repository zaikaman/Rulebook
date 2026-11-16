// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

import {MockSystemContract} from "../mocks/MockSystemContract.sol";

/// @notice Proves the sponsorship model from IDEA.md §12: `depositTo(target)` credits the
/// target from any caller, while a plain transfer credits nobody and strands the value.
contract SponsorshipTest is Test {
    address internal constant TARGET = address(0xA11CE);
    address internal constant STRANGER = address(0xB0B);

    MockSystemContract internal system;

    function setUp() public {
        system = new MockSystemContract();
    }

    function test_depositToCreditsTheTargetFromAnyCaller() public {
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        system.depositTo{value: 1 ether}(TARGET);

        assertEq(system.reserves(TARGET), 1 ether);
        assertEq(system.reserves(STRANGER), 0);
        assertEq(address(system).balance, 1 ether);
    }

    function test_depositToAddsToExistingReserves() public {
        system.setReserves(TARGET, 2 ether);
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        system.depositTo{value: 1 ether}(TARGET);

        assertEq(system.reserves(TARGET), 3 ether);
    }

    function test_plainTransferCreditsNoTargetAndStrandsTheValue() public {
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        (bool ok,) = address(system).call{value: 1 ether}("");

        assertTrue(ok);
        assertEq(system.reserves(TARGET), 0);
        assertEq(system.reserves(STRANGER), 0);
        assertEq(address(system).balance, 1 ether);
    }

    function test_depositToWithNoValueChangesNothing() public {
        system.depositTo(TARGET);
        assertEq(system.reserves(TARGET), 0);
    }
}

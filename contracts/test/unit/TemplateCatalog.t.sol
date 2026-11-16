// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

import {TemplateCatalog} from "../../src/libraries/TemplateCatalog.sol";

/// @notice Fails the build if generated Solidity constants drift from the shared manifest.
contract TemplateCatalogTest is Test {
    string internal manifest;

    function setUp() public {
        manifest = vm.readFile("../packages/shared/manifest/templates.json");
    }

    function _path(uint256 templateIndex, string memory tail)
        internal
        pure
        returns (string memory)
    {
        return string.concat(".templates[", vm.toString(templateIndex), "]", tail);
    }

    function test_templateCountMatchesManifest() public view {
        uint256 count = 0;
        while (true) {
            try vm.parseJsonUint(manifest, _path(count, ".id")) returns (uint256) {
                count += 1;
            } catch {
                break;
            }
        }
        assertEq(count, TemplateCatalog.TEMPLATE_COUNT, "manifest and Solidity counts differ");
    }

    function test_everyIdNameAndCategoryMatchesManifest() public view {
        for (uint256 i = 0; i < TemplateCatalog.TEMPLATE_COUNT; ++i) {
            uint8 id = uint8(vm.parseJsonUint(manifest, _path(i, ".id")));
            assertEq(id, i + 1, "ids must be 1..13 in order");
            assertTrue(TemplateCatalog.isKnown(id), "generated catalog must know every id");

            string memory name = vm.parseJsonString(manifest, _path(i, ".name"));
            assertEq(TemplateCatalog.nameOf(id), name, "name drift");

            string memory category = vm.parseJsonString(manifest, _path(i, ".category"));
            assertEq(TemplateCatalog.categoryOf(id), category, "category drift");
        }
    }

    function test_slotCountsMatchManifest() public view {
        for (uint256 i = 0; i < TemplateCatalog.TEMPLATE_COUNT; ++i) {
            uint8 id = uint8(vm.parseJsonUint(manifest, _path(i, ".id")));
            uint256 slots = 0;
            for (uint256 s = 0; s < 16; ++s) {
                string memory key = _path(i, string.concat(".slots[", vm.toString(s), "].key"));
                try vm.parseJsonString(manifest, key) returns (string memory) {
                    slots += 1;
                } catch {
                    break;
                }
            }
            assertEq(TemplateCatalog.slotCountOf(id), uint8(slots), "slot count drift");
        }
    }
}

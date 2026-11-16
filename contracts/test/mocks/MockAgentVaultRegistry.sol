// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice Minimal Agent double: returns whatever vault the test says was linked.
contract MockAgentVaultRegistry {
    address private _linkedVault;

    function setLinkedVault(address vault) external {
        _linkedVault = vault;
    }

    function getVault(uint256) external view returns (address vault) {
        vault = _linkedVault;
    }
}

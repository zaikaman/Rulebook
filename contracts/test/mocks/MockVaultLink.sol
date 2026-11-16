// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice Minimal Vault double exposing the Agent address used by `Agent.linkVault`.
contract MockVaultLink {
    address public immutable agent;

    constructor(address agent_) {
        agent = agent_;
    }
}

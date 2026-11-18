// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {Vault} from "./Vault.sol";

/// @notice A vault whose immutable mode allows mirror callbacks only.
contract MirrorVault is Vault {
    constructor(
        IPayable callbackProxy,
        address owner,
        address agent,
        address router,
        address tokenIn,
        address tokenOut,
        uint256 maxSpendPerRun
    ) Vault(callbackProxy, owner, agent, router, tokenIn, tokenOut, maxSpendPerRun, true) {}
}

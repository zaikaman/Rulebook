// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {InvalidCallbackPayload} from "./Errors.sol";

/// @notice The payload the Agent sends with `requestCallbackV_1_0`, decoded by the Vault's
/// `execute`. One struct, one codec: the two sides cannot drift apart (Constitution III).
/// @param template Catalog id, 1..13.
/// @param pair Uniswap V2 pair used for the price re-check and the execution-time quote.
/// @param threshold Rule threshold snapshot: the price the Agent decided against, or 0.
/// @param amountIn Per-run spend in `tokenIn` base units.
/// @param expiry Unix seconds after which the execution must not happen (0 = no expiry).
/// @param extra Per-template extra: swap decision floor, transfer recipient, or pull source.
struct ExecutionPayload {
    uint16 template;
    address pair;
    uint256 threshold;
    uint256 amountIn;
    uint64 expiry;
    uint256 extra;
}

/// @title CallbackPayload
/// @notice Encodes and decodes the only calldata the Agent may produce for a Vault.
library CallbackPayload {
    /// @notice Selector of `IVault.execute(address,uint256,bytes)`.
    bytes4 internal constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));

    /// @notice Builds the full callback calldata for `IVault.execute`.
    /// @dev The first argument is a placeholder: Reactive overwrites it with the calling
    /// Agent's address, and the Vault compares it against its own `agent` (never trusts it).
    function encode(uint256 ruleId, ExecutionPayload memory payload)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(
            EXECUTE_SELECTOR,
            address(0),
            ruleId,
            abi.encode(
                payload.template,
                payload.pair,
                payload.threshold,
                payload.amountIn,
                payload.expiry,
                payload.extra
            )
        );
    }

    /// @notice Decodes the inner `execute` argument back into its six fields.
    /// @dev A wrong length is a mismatched caller, not a user error: it reverts.
    function decode(bytes calldata data) internal pure returns (ExecutionPayload memory payload) {
        if (data.length < 192) revert InvalidCallbackPayload();
        (
            payload.template,
            payload.pair,
            payload.threshold,
            payload.amountIn,
            payload.expiry,
            payload.extra
        ) = abi.decode(data, (uint16, address, uint256, uint256, uint64, uint256));
    }
}

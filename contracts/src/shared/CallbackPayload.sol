// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {InvalidCallbackPayload} from "./Errors.sol";

/// @notice The payload the Agent sends with `requestCallbackV_1_0`, decoded by the Vault's
/// `execute`. One struct, one codec: the two sides cannot drift apart (Constitution III).
/// @param template Catalog id, 1..13.
/// @param pair Uniswap V2 pair used for the price re-check and the execution-time quote.
/// @param threshold Rule threshold snapshot: the price the Agent decided against, or 0.
/// @param amountIn Per-run spend in `tokenIn` base units.
/// @param expiry Unix seconds after which the execution must not happen.
/// @param extra Grid band, transfer recipient, or pull source in the low bits. A replacement
/// carries its destination-side activation time above those bits.
/// @param tokenIn Token authorized by the rule, independent of future vault configuration.
/// @param tokenOut Output token for swaps.
/// @param sequence Monotonic execution attempt within the rule.
struct ExecutionPayload {
    uint16 template;
    address pair;
    uint256 threshold;
    uint256 amountIn;
    uint64 expiry;
    uint256 extra;
    address tokenIn;
    address tokenOut;
    uint32 sequence;
}

/// @notice A proportional swap with an independent output floor and leader provenance.
struct MirrorPayload {
    address pair;
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minOut;
    address leaderVault;
    bytes32 leaderTx;
    uint256 leaderRuleId;
}

/// @title CallbackPayload
/// @notice Encodes and decodes the only calldata the Agent may produce for a Vault.
library CallbackPayload {
    /// @notice Selector of `IVault.execute(address,uint256,bytes)`.
    bytes4 internal constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 internal constant REPLACEMENT_SELECTOR = bytes4(keccak256("executeReplacement(address,uint256,bytes)"));
    bytes4 internal constant MIRROR_SELECTOR = bytes4(keccak256("executeMirror(address,uint256,bytes)"));

    /// @notice Builds the full callback, leaving Reactive's sender slot empty.
    function encodeMirror(uint256 ruleId, MirrorPayload memory payload) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(MIRROR_SELECTOR, address(0), ruleId, abi.encode(payload));
    }

    /// @notice Decodes an exact mirror payload.
    function decodeMirror(bytes calldata payload) internal pure returns (MirrorPayload memory) {
        if (payload.length != 256) revert InvalidCallbackPayload();
        return abi.decode(payload, (MirrorPayload));
    }

    /// @notice Identifies a leader execution independently of the follower rule's lifetime.
    function mirrorExecutionKey(address vault, uint256 ruleId, bytes32 txHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(vault, ruleId, txHash));
    }

    /// @notice Builds the full callback calldata for `IVault.execute`.
    /// @dev The first argument is a placeholder: Reactive overwrites it with the calling
    /// Agent's address, and the Vault compares it against its own `agent` (never trusts it).
    function encode(uint256 ruleId, ExecutionPayload memory payload) internal pure returns (bytes memory) {
        bytes4 selector = payload.extra >> 160 == 0 ? EXECUTE_SELECTOR : REPLACEMENT_SELECTOR;
        return abi.encodeWithSelector(selector, address(0), ruleId, abi.encode(payload));
    }

    /// @notice Decodes the inner `execute` argument back into its exact fields.
    /// @dev A wrong length is a mismatched caller, not a user error: it reverts.
    function decode(bytes calldata data) internal pure returns (ExecutionPayload memory payload) {
        if (data.length != 288) revert InvalidCallbackPayload();
        return abi.decode(data, (ExecutionPayload));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice Callback request shape accepted by the Reactive system contract.
struct CallbackConfiguration {
    uint256 chainId;
    address recipient;
    uint64 gasLimit;
    bytes payload;
}

/// @notice One callback record as returned by `getCallbacks` on the Lasna system contract.
struct CallbackRecord {
    uint256 blockNumber;
    address reactingContract;
    uint256 callbackIndex;
    uint256 destinationChainId;
    uint256 destinationTxHash;
    bytes errorData;
}

/// @notice The subset of the Reactive system contract the Rulebook contracts call.
interface IReactiveSystem {
    /// @notice Requests a callback on `config.chainId`; the callback carries `config.payload`.
    function requestCallbackV_1_0(CallbackConfiguration calldata config) external;

    /// @notice Subscribes the calling contract to matching logs.
    function subscribe(
        uint256 chainId,
        address contractAddress,
        uint256 topic0,
        uint256 topic1,
        uint256 topic2,
        uint256 topic3
    ) external;

    /// @notice Removes a subscription matching the same criteria.
    function unsubscribe(
        uint256 chainId,
        address contractAddress,
        uint256 topic0,
        uint256 topic1,
        uint256 topic2,
        uint256 topic3
    ) external;
}

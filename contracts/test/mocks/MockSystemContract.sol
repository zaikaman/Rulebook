// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {
    CallbackConfiguration,
    CallbackRecord,
    IReactiveSystem
} from "../../src/shared/ReactiveTypes.sol";

/// @notice Lasna system-contract double: records callback requests and subscriptions,
/// serves settable callback records, and tracks reserves/debt.
contract MockSystemContract is IReactiveSystem {
    CallbackConfiguration[] private _requests;
    CallbackRecord[] private _callbacks;

    mapping(address => uint256) public reserves;
    mapping(address => uint256) public debts;
    mapping(bytes32 => bool) private _subscribed;

    uint256 public subscribeCount;
    uint256 public unsubscribeCount;
    uint256 public lastSubscribedTopic;
    uint256 public lastSubscribedTopic1;
    uint256 public lastUnsubscribedTopic1;

    function requestCallbackV_1_0(CallbackConfiguration calldata config) external {
        _requests.push(config);
    }

    function subscribe(
        uint256 chainId,
        address source,
        uint256 topic0,
        uint256 topic1,
        uint256,
        uint256
    ) external {
        subscribeCount += 1;
        lastSubscribedTopic = topic0;
        lastSubscribedTopic1 = topic1;
        _subscribed[keccak256(abi.encode(chainId, source, topic0))] = true;
    }

    function unsubscribe(
        uint256 chainId,
        address source,
        uint256 topic0,
        uint256 topic1,
        uint256,
        uint256
    ) external {
        unsubscribeCount += 1;
        lastUnsubscribedTopic1 = topic1;
        _subscribed[keccak256(abi.encode(chainId, source, topic0))] = false;
    }

    function isSubscribed(uint256 chainId, address source, uint256 topic0)
        external
        view
        returns (bool)
    {
        return _subscribed[keccak256(abi.encode(chainId, source, topic0))];
    }

    function requestCount() external view returns (uint256 count) {
        count = _requests.length;
    }

    function requestAt(uint256 index) external view returns (CallbackConfiguration memory request) {
        request = _requests[index];
    }

    function setCallbacks(CallbackRecord[] calldata records) external {
        delete _callbacks;
        for (uint256 i = 0; i < records.length; ++i) {
            _callbacks.push(records[i]);
        }
    }

    function getCallbacks(uint256) external view returns (CallbackRecord[] memory records) {
        records = _callbacks;
    }

    /// @notice Permissionless reserve top-up; settles debt first in production.
    function depositTo(address target) external payable {
        reserves[target] += msg.value;
    }

    /// @notice A plain transfer raises the system balance without crediting any target.
    receive() external payable {}

    function setReserves(address account, uint256 amount) external {
        reserves[account] = amount;
    }

    function setDebt(address account, uint256 amount) external {
        debts[account] = amount;
    }

    function debt(address account) external view returns (uint256 amount) {
        amount = debts[account];
    }
}

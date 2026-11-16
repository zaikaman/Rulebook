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

    uint256 public subscribeCount;
    uint256 public unsubscribeCount;
    uint256 public lastSubscribedTopic;

    function requestCallbackV_1_0(CallbackConfiguration calldata config) external {
        _requests.push(config);
    }

    function subscribe(uint256, address, uint256 topic0, uint256, uint256, uint256) external {
        subscribeCount += 1;
        lastSubscribedTopic = topic0;
    }

    function unsubscribe(uint256, address, uint256, uint256, uint256, uint256) external {
        unsubscribeCount += 1;
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

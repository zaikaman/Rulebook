// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice Callback proxy double: the only address the Vault accepts as a callback sender.
contract MockCallbackProxy {
    mapping(address => uint256) public debts;

    receive() external payable {}

    function debt(address account) external view returns (uint256 amount) {
        amount = debts[account];
    }

    function setDebt(address account, uint256 amount) external {
        debts[account] = amount;
    }
}

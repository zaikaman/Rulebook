// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {WorkflowVault} from "./WorkflowVault.sol";

contract WorkflowVaultFactory {
    event WorkflowVaultCreated(address indexed owner, address indexed vault, address indexed agent);

    error AgentMismatch();

    address public immutable callbackProxy;
    mapping(address => address) public vaultOf;

    constructor(address callbackProxy_) {
        callbackProxy = callbackProxy_;
    }

    function create(address agent) external returns (address vault) {
        vault = vaultOf[msg.sender];
        if (vault != address(0)) {
            if (WorkflowVault(payable(vault)).agent() != agent) revert AgentMismatch();
            return vault;
        }
        vault = address(new WorkflowVault(callbackProxy, msg.sender, agent));
        vaultOf[msg.sender] = vault;
        emit WorkflowVaultCreated(msg.sender, vault, agent);
    }
}


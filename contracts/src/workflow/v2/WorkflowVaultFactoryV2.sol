// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {ChainConfig} from "../../chain/ChainConfig.sol";
import {WorkflowProtocolsV2} from "./WorkflowProtocolsV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";
import {WorkflowVaultV2} from "./WorkflowVaultV2.sol";

/// @notice Creates at most one V2 settlement Vault per wallet on this testnet.
contract WorkflowVaultFactoryV2 {
    event VaultCreated(address indexed owner, address indexed vault, address indexed agent);
    error AgentMismatch();
    error InactiveDeployment();

    uint32 public immutable chain;
    address public immutable callbackProxy;
    WorkflowProgramValidatorV2 public immutable validator;
    mapping(address => address) public vaultOf;
    WorkflowProtocolsV2.Networks private market;

    constructor() {
        if (block.chainid == ChainConfig.LASNA || !ChainConfig.isSupported(block.chainid)) {
            revert InactiveDeployment();
        }
        ChainConfig.Config memory config = ChainConfig.get(block.chainid);
        callbackProxy = config.callbackProxy;
        market = WorkflowProtocolsV2.Networks(config.usdc, config.weth, config.router, config.pair);
        if (callbackProxy.code.length == 0) revert InactiveDeployment();
        chain = uint32(block.chainid);
        validator = new WorkflowProgramValidatorV2();
    }

    function create(address agent) external returns (address vault) {
        vault = vaultOf[msg.sender];
        if (vault != address(0)) {
            if (WorkflowVaultV2(payable(vault)).agent() != agent) revert AgentMismatch();
            return vault;
        }
        vault = address(
            new WorkflowVaultV2(callbackProxy, msg.sender, agent, chain, market, validator)
        );
        vaultOf[msg.sender] = vault;
        emit VaultCreated(msg.sender, vault, agent);
    }
}

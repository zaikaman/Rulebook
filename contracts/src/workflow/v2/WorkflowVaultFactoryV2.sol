// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ChainConfig} from "../../chain/ChainConfig.sol";
import {WorkflowProtocolsV2} from "./WorkflowProtocolsV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";
import {WorkflowVaultV2} from "./WorkflowVaultV2.sol";

/// @notice Creates at most one V2 settlement Vault per wallet on this funds network.
contract WorkflowVaultFactoryV2 {
    event VaultCreated(address indexed owner, address indexed vault, address indexed agent);
    error AgentMismatch();
    error InactiveDeployment();

    uint32 public immutable chain;
    address public immutable callbackProxy;
    address public immutable implementation;
    WorkflowProgramValidatorV2 public immutable validator;
    mapping(address => address) public vaultOf;

    constructor() {
        if (!ChainConfig.isFundsChain(block.chainid)) revert InactiveDeployment();
        ChainConfig.Config memory config = ChainConfig.get(block.chainid);
        callbackProxy = config.callbackProxy;
        bool missingOracle = ChainConfig.isMainnetFundsChain(block.chainid)
            && (config.router.code.length == 0
                || config.pair.code.length == 0
                || config.ethUsdFeed.code.length == 0
                || config.sequencerFeed.code.length == 0
                || (config.usdcUsdFeed != address(0) && config.usdcUsdFeed.code.length == 0));
        if (callbackProxy.code.length == 0 || missingOracle) revert InactiveDeployment();
        WorkflowProtocolsV2.Networks memory market = WorkflowProtocolsV2.Networks(
            config.usdc,
            config.weth,
            config.router,
            config.pair,
            config.poolFee,
            config.ethUsdFeed,
            config.usdcUsdFeed,
            config.sequencerFeed,
            config.ethFeedMaxAge,
            config.usdcFeedMaxAge
        );
        chain = uint32(block.chainid);
        validator = new WorkflowProgramValidatorV2();
        implementation = address(
            new WorkflowVaultV2(callbackProxy, address(0), address(0), chain, market, validator)
        );
    }

    function create(address agent) external returns (address vault) {
        vault = vaultOf[msg.sender];
        if (vault != address(0)) {
            if (WorkflowVaultV2(payable(vault)).agent() != agent) revert AgentMismatch();
            return vault;
        }
        vault = Clones.clone(implementation);
        WorkflowVaultV2(payable(vault)).initialize(msg.sender, agent);
        vaultOf[msg.sender] = vault;
        emit VaultCreated(msg.sender, vault, agent);
    }
}

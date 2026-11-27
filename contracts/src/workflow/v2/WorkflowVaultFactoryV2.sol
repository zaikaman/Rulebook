// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC1822Proxiable} from "@openzeppelin/contracts/interfaces/draft-IERC1822.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ChainConfig} from "../../chain/ChainConfig.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";
import {WorkflowVaultV2} from "./WorkflowVaultV2.sol";

/// @notice Creates at most one V2 settlement Vault proxy per wallet on this funds network.
contract WorkflowVaultFactoryV2 {
    event VaultCreated(address indexed owner, address indexed vault, address indexed agent);
    event ImplementationApproved(address indexed implementation, bool current);
    event AdminUpdated(address indexed previousAdmin, address indexed nextAdmin);
    error AgentMismatch();
    error InactiveDeployment();
    error Unauthorized();
    error InvalidImplementation();

    uint32 public immutable chain;
    address public immutable callbackProxy;
    WorkflowProgramValidatorV2 public immutable validator;
    address public admin;
    address public implementation;
    mapping(address => bool) public approvedImplementation;
    mapping(address => address) public vaultOf;

    constructor(WorkflowProgramValidatorV2 validator_, address implementation_) {
        if (!ChainConfig.isFundsChain(block.chainid)) revert InactiveDeployment();
        ChainConfig.Config memory config = ChainConfig.get(block.chainid);
        callbackProxy = config.callbackProxy;
        bool missingOracle = ChainConfig.isMainnetFundsChain(block.chainid)
            && (config.router.code.length == 0
                || config.pair.code.length == 0
                || config.ethUsdFeed.code.length == 0
                || config.sequencerFeed.code.length == 0
                || (config.usdcUsdFeed != address(0) && config.usdcUsdFeed.code.length == 0));
        if (
            callbackProxy.code.length == 0 || missingOracle || address(validator_) == address(0)
                || address(validator_).code.length == 0
        ) revert InactiveDeployment();
        chain = uint32(block.chainid);
        validator = validator_;
        admin = msg.sender;
        _approveImplementation(implementation_, true);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    function approveImplementation(address impl, bool makeCurrent) external onlyAdmin {
        _approveImplementation(impl, makeCurrent);
    }

    function setAdmin(address nextAdmin) external onlyAdmin {
        if (nextAdmin == address(0)) revert Unauthorized();
        address previous = admin;
        admin = nextAdmin;
        emit AdminUpdated(previous, nextAdmin);
    }

    function _approveImplementation(address impl, bool makeCurrent) private {
        if (impl == address(0) || impl.code.length == 0) revert InvalidImplementation();
        (bool okUuid, bytes memory uuidData) =
            impl.staticcall(abi.encodeCall(IERC1822Proxiable.proxiableUUID, ()));
        if (
            !okUuid || uuidData.length != 32
                || abi.decode(uuidData, (bytes32)) != ERC1967Utils.IMPLEMENTATION_SLOT
        ) {
            revert InvalidImplementation();
        }
        (bool okChain, bytes memory chainData) = impl.staticcall(abi.encodeWithSignature("chain()"));
        if (!okChain || chainData.length != 32 || abi.decode(chainData, (uint256)) != chain) {
            revert InvalidImplementation();
        }
        approvedImplementation[impl] = true;
        if (makeCurrent) {
            implementation = impl;
        }
        emit ImplementationApproved(impl, makeCurrent);
    }

    function create(address agent) external returns (address vault) {
        vault = vaultOf[msg.sender];
        if (vault != address(0)) {
            if (WorkflowVaultV2(payable(vault)).agent() != agent) revert AgentMismatch();
            return vault;
        }
        vault = address(
            new ERC1967Proxy(
                implementation, abi.encodeCall(WorkflowVaultV2.initialize, (msg.sender, agent))
            )
        );
        vaultOf[msg.sender] = vault;
        emit VaultCreated(msg.sender, vault, agent);
    }
}

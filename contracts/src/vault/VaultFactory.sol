// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {ChainConfig} from "../chain/ChainConfig.sol";
import {Vault} from "./Vault.sol";
import {
    AgentAlreadyLinked,
    InvalidTemplateParams,
    NotAgent,
    NotOwner,
    TokenMismatch
} from "../shared/Errors.sol";

/// @title VaultFactory
/// @notice Deploys one Vault per `(owner, chainId)` on Unichain Sepolia.
/// @dev Requires an existing Agent owned by the same user; a second deploy reverts.
contract VaultFactory {
    /// @notice Emitted on every successful deployment.
    event VaultDeployed(
        address indexed owner, address indexed vault, address indexed agent, uint256 chainId
    );

    /// @notice Default per-run ceiling: 100 USDC in base units, refined by the owner later.
    uint256 public constant DEFAULT_MAX_SPEND_PER_RUN = 100e6;

    /// @notice The Reactive callback proxy every vault trusts.
    IPayable public immutable callbackProxy;

    mapping(address => address) private _vaultOf;
    mapping(address => uint256) private _vaultChainOf;

    constructor(IPayable callbackProxy_) {
        callbackProxy = callbackProxy_;
    }

    /// @notice Deploys the vault for `owner_`, linked to `agent_`.
    /// @dev The factory never becomes owner; `owner_` is written into the vault.
    function deploy(address owner_, address agent_, address tokenIn_, address tokenOut_)
        external
        returns (address vault)
    {
        if (agent_.code.length == 0) revert NotAgent();
        if (IAgentOwnable(agent_).owner() != owner_) revert NotOwner();
        if (_vaultOf[owner_] != address(0)) revert AgentAlreadyLinked();
        if (tokenIn_ == address(0) || tokenOut_ == address(0)) {
            revert InvalidTemplateParams();
        }
        if (tokenIn_ == tokenOut_) revert TokenMismatch(tokenIn_, tokenOut_);

        uint256 chainId = block.chainid;
        ChainConfig.Config memory config = ChainConfig.get(chainId);
        vault = address(
            new Vault(
                callbackProxy,
                owner_,
                agent_,
                config.router,
                tokenIn_,
                tokenOut_,
                DEFAULT_MAX_SPEND_PER_RUN,
                false
            )
        );
        _vaultOf[owner_] = vault;
        _vaultChainOf[owner_] = chainId;
        emit VaultDeployed(owner_, vault, agent_, chainId);
    }

    /// @notice The vault deployed for `owner_`, or the zero address.
    function vaultOf(address owner_) external view returns (address vault) {
        vault = _vaultOf[owner_];
    }

    /// @notice The chain id the owner's vault was deployed for.
    function vaultChainOf(address owner_) external view returns (uint256 chainId) {
        chainId = _vaultChainOf[owner_];
    }
}

interface IAgentOwnable {
    function owner() external view returns (address);
}

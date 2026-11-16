// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IPayable} from "@reactive/interfaces/IPayable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {ChainConfig} from "../chain/ChainConfig.sol";
import {Vault} from "./Vault.sol";
import {
    AgentAlreadyLinked,
    InvalidTemplateParams,
    InvalidVaultAuthorization,
    TokenMismatch
} from "../shared/Errors.sol";

/// @title VaultFactory
/// @notice Deploys one Vault per `(owner, chainId)` on Unichain Sepolia.
/// @dev Requires an owner signature binding the remote Agent; a second deploy reverts.
contract VaultFactory is EIP712 {
    /// @notice Emitted on every successful deployment.
    event VaultDeployed(
        address indexed owner, address indexed vault, address indexed agent, uint256 chainId
    );

    /// @notice Default per-run ceiling: 100 USDC in base units, refined by the owner later.
    uint256 public constant DEFAULT_MAX_SPEND_PER_RUN = 100e6;
    uint256 public constant MAX_AUTHORIZATION_LIFETIME = 1 days;
    bytes32 public constant VAULT_DEPLOYMENT_TYPEHASH = keccak256(
        "VaultDeployment(address owner,address agent,address tokenIn,address tokenOut,uint256 nonce,uint256 deadline)"
    );

    /// @notice The Reactive callback proxy every vault trusts.
    IPayable public immutable callbackProxy;

    mapping(address => address) private _vaultOf;
    mapping(address => uint256) private _vaultChainOf;
    mapping(address => uint256) public nonces;

    constructor(IPayable callbackProxy_) EIP712("Rulebook Vault Factory", "1") {
        if (address(callbackProxy_) == address(0)) revert InvalidTemplateParams();
        callbackProxy = callbackProxy_;
    }

    /// @notice Deploys the vault for `owner_`, linked to `agent_`.
    /// @dev The factory never becomes owner; `owner_` is written into the vault.
    function deploy(
        address owner_,
        address agent_,
        address tokenIn_,
        address tokenOut_,
        uint256 deadline_,
        bytes calldata authorization_
    )
        external
        returns (address vault)
    {
        if (
            owner_ == address(0) || agent_ == address(0) || deadline_ < block.timestamp
                || deadline_ > block.timestamp + MAX_AUTHORIZATION_LIFETIME
        ) {
            revert InvalidVaultAuthorization();
        }
        if (_vaultOf[owner_] != address(0)) revert AgentAlreadyLinked();
        if (tokenIn_ == address(0) || tokenOut_ == address(0)) {
            revert InvalidTemplateParams();
        }
        if (tokenIn_ == tokenOut_) revert TokenMismatch(tokenIn_, tokenOut_);

        _consumeAuthorization(owner_, agent_, tokenIn_, tokenOut_, deadline_, authorization_);

        vault = _deployVault(owner_, agent_, tokenIn_, tokenOut_);
        _vaultOf[owner_] = vault;
        _vaultChainOf[owner_] = block.chainid;
        emit VaultDeployed(owner_, vault, agent_, block.chainid);
    }

    /// @notice The vault deployed for `owner_`, or the zero address.
    function vaultOf(address owner_) external view returns (address vault) {
        vault = _vaultOf[owner_];
    }

    /// @notice The chain id the owner's vault was deployed for.
    function vaultChainOf(address owner_) external view returns (uint256 chainId) {
        chainId = _vaultChainOf[owner_];
    }

    function _consumeAuthorization(
        address owner_,
        address agent_,
        address tokenIn_,
        address tokenOut_,
        uint256 deadline_,
        bytes calldata authorization_
    ) private {
        uint256 nonce = nonces[owner_];
        bytes32 structHash = keccak256(
            abi.encode(
                VAULT_DEPLOYMENT_TYPEHASH,
                owner_,
                agent_,
                tokenIn_,
                tokenOut_,
                nonce,
                deadline_
            )
        );
        if (!SignatureChecker.isValidSignatureNow(owner_, _hashTypedDataV4(structHash), authorization_)) {
            revert InvalidVaultAuthorization();
        }
        nonces[owner_] = nonce + 1;
    }

    function _deployVault(address owner_, address agent_, address tokenIn_, address tokenOut_)
        private
        returns (address vault)
    {
        ChainConfig.Config memory config = ChainConfig.get(block.chainid);
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
    }
}

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
    /// @notice Marks a deployment as a mirror-only vault without changing VaultDeployed.
    event MirrorVaultDeployed(address indexed vault);

    /// @notice Default per-run ceiling: 100 USDC in base units, refined by the owner later.
    uint256 public constant DEFAULT_MAX_SPEND_PER_RUN = 100e6;
    uint256 public constant MAX_AUTHORIZATION_LIFETIME = 1 days;
    bytes32 public constant VAULT_DEPLOYMENT_TYPEHASH = keccak256(
        "VaultDeployment(address owner,address agent,address tokenIn,address tokenOut,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant MIRROR_DEPLOYMENT_TYPEHASH = keccak256(
        "MirrorVaultDeployment(address owner,address agent,address tokenIn,address tokenOut,uint256 nonce,uint256 deadline)"
    );

    struct Deployment {
        address owner;
        address agent;
        address tokenIn;
        address tokenOut;
        uint256 deadline;
    }

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
    ) external returns (address vault) {
        return _deploy(
            Deployment(owner_, agent_, tokenIn_, tokenOut_, deadline_), authorization_, false
        );
    }

    /// @notice Deploys an immutable mirror vault with a mode-specific owner authorization.
    function deployMirror(
        address owner_,
        address agent_,
        address tokenIn_,
        address tokenOut_,
        uint256 deadline_,
        bytes calldata authorization_
    ) external returns (address vault) {
        return _deploy(
            Deployment(owner_, agent_, tokenIn_, tokenOut_, deadline_), authorization_, true
        );
    }

    function _deploy(Deployment memory spec, bytes calldata authorization, bool mirror)
        private
        returns (address vault)
    {
        if (
            spec.owner == address(0) || spec.agent == address(0) || spec.deadline < block.timestamp
                || spec.deadline > block.timestamp + MAX_AUTHORIZATION_LIFETIME
        ) {
            revert InvalidVaultAuthorization();
        }
        if (_vaultOf[spec.owner] != address(0)) revert AgentAlreadyLinked();
        if (spec.tokenIn == address(0) || spec.tokenOut == address(0)) {
            revert InvalidTemplateParams();
        }
        if (spec.tokenIn == spec.tokenOut) revert TokenMismatch(spec.tokenIn, spec.tokenOut);

        _consumeAuthorization(spec, authorization, mirror);

        vault = _deployVault(spec, mirror);
        _vaultOf[spec.owner] = vault;
        _vaultChainOf[spec.owner] = block.chainid;
        emit VaultDeployed(spec.owner, vault, spec.agent, block.chainid);
        if (mirror) emit MirrorVaultDeployed(vault);
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
        Deployment memory spec,
        bytes calldata authorization,
        bool mirror
    ) private {
        uint256 nonce = nonces[spec.owner];
        bytes32 structHash = keccak256(
            abi.encode(
                mirror ? MIRROR_DEPLOYMENT_TYPEHASH : VAULT_DEPLOYMENT_TYPEHASH,
                spec.owner,
                spec.agent,
                spec.tokenIn,
                spec.tokenOut,
                nonce,
                spec.deadline
            )
        );
        if (!SignatureChecker.isValidSignatureNow(
                spec.owner, _hashTypedDataV4(structHash), authorization
            )) {
            revert InvalidVaultAuthorization();
        }
        nonces[spec.owner] = nonce + 1;
    }

    function _deployVault(Deployment memory spec, bool mirror) private returns (address vault) {
        ChainConfig.Config memory config = ChainConfig.get(block.chainid);
        vault = address(
            new Vault(
                callbackProxy,
                spec.owner,
                spec.agent,
                config.router,
                spec.tokenIn,
                spec.tokenOut,
                DEFAULT_MAX_SPEND_PER_RUN,
                mirror
            )
        );
    }
}

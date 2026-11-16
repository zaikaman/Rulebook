// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AbstractCallback} from "@reactive/abstract-base/AbstractCallback.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {
    AgentNotLinked,
    CallbackSenderMismatch,
    ConditionNotMet,
    InsufficientPrincipal,
    InvalidAmount,
    InvalidTemplateParams,
    NotOwner,
    NotServiceProvider,
    TokenMismatch,
    UnknownTemplate
} from "../shared/Errors.sol";

/// @title Vault
/// @notice One user's funds-side account on Unichain Sepolia. Holds principal, enforces limits,
/// and executes only when the linked Agent is the callback sender.
/// @dev Authentication is inherited from Reactive's `AbstractCallback`; this contract never
/// reimplements the proxy allowlist.
contract Vault is AbstractCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Emitted only by leader vaults after a funds-side execution.
    event Executed(
        uint256 indexed ruleId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 timestamp
    );
    /// @notice Emitted only by mirror vaults; never emitted alongside `Executed`.
    event Mirrored(uint256 indexed ruleId, address indexed leader, bytes32 leaderTx);
    /// @notice Principal withdrawn or spent from the vault.
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    /// @notice Token principal added to the vault through `deposit`.
    event Deposited(address indexed token, uint256 amount, address indexed from);
    /// @notice Balances after every balance change; the balance-floor template listens to this.
    event Balances(address token0, uint256 balance0, address token1, uint256 balance1);
    /// @notice Payout destination changed by the owner.
    event PayoutAddressChanged(address indexed previous, address indexed next);
    /// @notice Spend limits and the allowlisted pair changed by the owner.
    event LimitsChanged(uint256 maxSpendPerRun, address tokenIn, address tokenOut);

    /// @notice The user who owns this vault and its principal.
    address public immutable owner;
    /// @notice The only Agent allowed to trigger execution.
    address public immutable agent;
    /// @notice Uniswap V2 Router02 address from the per-chain config.
    address public immutable router;
    /// @notice True for mirror vaults, which emit `Mirrored` instead of `Executed`.
    bool public immutable mirrorMode;

    /// @notice Owner's emergency stop. Blocks execution, never withdrawal.
    bool public paused;
    /// @notice Ceiling for one rule's spend, enforced on execution.
    uint256 public maxSpendPerRun;
    /// @notice Allowlisted input token.
    address public allowedTokenIn;
    /// @notice Allowlisted output token.
    address public allowedTokenOut;
    /// @notice Default destination for withdrawals that pass the zero address.
    address public payoutAddress;

    mapping(address => uint256) private _principal;

    constructor(
        IPayable callbackProxy,
        address owner_,
        address agent_,
        address router_,
        address tokenIn_,
        address tokenOut_,
        uint256 maxSpendPerRun_,
        bool mirrorMode_
    ) AbstractCallback(address(callbackProxy)) {
        if (owner_ == address(0) || agent_ == address(0) || router_ == address(0)) {
            revert InvalidTemplateParams();
        }
        _validateAllowlist(tokenIn_, tokenOut_);
        if (maxSpendPerRun_ == 0) revert InvalidAmount();
        owner = owner_;
        agent = agent_;
        router = router_;
        maxSpendPerRun = maxSpendPerRun_;
        allowedTokenIn = tokenIn_;
        allowedTokenOut = tokenOut_;
        mirrorMode = mirrorMode_;
        payoutAddress = owner_;
    }

    modifier onlyVaultOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyServiceProvider() {
        if (!senders[msg.sender]) revert NotServiceProvider();
        _;
    }

    modifier onlyCallbackSender(address expected) {
        if (expected != agent) revert CallbackSenderMismatch(agent, expected);
        _;
    }

    /// @notice Deposits principal on the owner's behalf.
    /// @dev A plain ERC20 transfer cannot emit `Balances`, so the app uses this entry point.
    function deposit(address token, uint256 amount) external nonReentrant {
        if (token == address(0) || amount == 0) revert InvalidAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _principal[token] += amount;
        emit Deposited(token, amount, msg.sender);
        _emitBalances(token, allowedTokenOut);
    }

    /// @notice Withdraws principal to `to`, or to the payout address when `to` is zero.
    /// @dev Always allowed, including while paused: custody belongs to the owner (FR-006).
    function withdraw(address token, uint256 amount, address to)
        external
        onlyVaultOwner
        nonReentrant
    {
        uint256 available = _principal[token];
        if (amount > available) revert InsufficientPrincipal(amount, available);
        address recipient = to == address(0) ? payoutAddress : to;
        if (recipient == address(0)) revert InvalidTemplateParams();
        _principal[token] = available - amount;
        IERC20(token).safeTransfer(recipient, amount);
        emit Withdrawn(token, amount, recipient);
        _emitBalances(token, allowedTokenOut);
    }

    /// @notice Sets where withdrawals go when no destination is supplied.
    function setPayoutAddress(address payout) external onlyVaultOwner {
        if (payout == address(0)) revert InvalidTemplateParams();
        address previous = payoutAddress;
        payoutAddress = payout;
        emit PayoutAddressChanged(previous, payout);
    }

    /// @notice Sets the per-run ceiling and the allowlisted token pair.
    function setLimits(uint256 maxSpendPerRun_, address tokenIn_, address tokenOut_)
        external
        onlyVaultOwner
    {
        _validateAllowlist(tokenIn_, tokenOut_);
        if (maxSpendPerRun_ == 0) revert InvalidAmount();
        maxSpendPerRun = maxSpendPerRun_;
        allowedTokenIn = tokenIn_;
        allowedTokenOut = tokenOut_;
        emit LimitsChanged(maxSpendPerRun_, tokenIn_, tokenOut_);
    }

    /// @notice Owner's emergency stop for execution.
    function setPaused(bool paused_) external onlyVaultOwner {
        paused = paused_;
    }

    /// @notice Reactive callback entry point. The `agent` argument is compared, never trusted.
    /// @dev Phase 2 ships authentication, the pause check, and payload decoding. The transfer
    /// path lands in T171 and the swap path in T174; until then no funds can move from here.
    /// @dev A vault the Agent has not recorded through `linkVault` refuses every callback: a
    /// deployment alone is not enough to move this vault's funds (FR-003).
    function execute(address agent_, uint256 ruleId, bytes calldata data) external view {
        _authenticate(agent_);
        if (paused) revert ConditionNotMet();
        _requireLinkedAgent();
        if (ruleId > type(uint32).max) revert InvalidTemplateParams();
        uint16 template = _decodeTemplate(data);
        if (template < 1 || template > 13) revert UnknownTemplate(uint8(template));
        revert ConditionNotMet();
    }

    /// @notice Principal recorded for `token`.
    function principalOf(address token) external view returns (uint256 amount) {
        amount = _principal[token];
    }

    /// @dev Proxy-sender check followed by the payload's first-argument check.
    function _authenticate(address agent_) private view {
        if (!senders[msg.sender]) revert NotServiceProvider();
        if (agent_ != agent) revert CallbackSenderMismatch(agent, agent_);
    }

    /// @dev Reads the Agent's destination-vault record. A failed or empty read is a refusal, so
    /// a vault cannot execute merely because someone constructed it with this Agent address.
    function _requireLinkedAgent() private view {
        (bool ok, bytes memory data) =
            agent.staticcall(abi.encodeCall(IAgentVaults.getVault, (block.chainid)));
        if (!ok || data.length < 32 || abi.decode(data, (address)) != address(this)) {
            revert AgentNotLinked();
        }
    }

    /// @dev The callback payload always starts with the template id.
    function _decodeTemplate(bytes calldata data) private pure returns (uint16 template) {
        if (data.length < 32) revert InvalidTemplateParams();
        (template,,,,,) = abi.decode(data, (uint16, address, uint256, uint256, uint64, uint256));
    }

    function _validateAllowlist(address tokenIn_, address tokenOut_) private pure {
        if (tokenIn_ == address(0) || tokenOut_ == address(0)) {
            revert InvalidTemplateParams();
        }
        if (tokenIn_ == tokenOut_) revert TokenMismatch(tokenIn_, tokenOut_);
    }

    function _emitBalances(address token0, address token1) private {
        uint256 balance0 = token0 == address(0) ? 0 : IERC20(token0).balanceOf(address(this));
        uint256 balance1 = token1 == address(0) ? 0 : IERC20(token1).balanceOf(address(this));
        emit Balances(token0, balance0, token1, balance1);
    }
}

interface IAgentVaults {
    function getVault(uint256 chainId) external view returns (address vault);
}

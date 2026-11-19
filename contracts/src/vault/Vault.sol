// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AbstractCallback} from "@reactive/abstract-base/AbstractCallback.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";

import {PriceMath} from "../libraries/PriceMath.sol";
import {RuleLib} from "../libraries/RuleLib.sol";
import {CallbackPayload, ExecutionPayload, MirrorPayload} from "../shared/CallbackPayload.sol";
import {
    AlertOnlyTemplate,
    CallbackSenderMismatch,
    ConditionNotMet,
    DuplicateLeaderExecution,
    ExceedsPerRunCap,
    Expired,
    InsufficientPrincipal,
    InvalidAmount,
    InvalidSecondary,
    InvalidTemplateParams,
    InvalidThreshold,
    MirrorDepthNotAllowed,
    NotOwner,
    NotServiceProvider,
    SlippageExceeded,
    StaleExecution,
    TokenMismatch,
    TransferFailed,
    UnknownTemplate
} from "../shared/Errors.sol";
import {IUniswapV2Factory, IUniswapV2Pair, IUniswapV2Router02} from "../shared/UniswapV2.sol";

/// @title Vault
/// @notice One user's funds-side account on Unichain Sepolia. Holds principal, enforces limits,
/// and executes only when the linked Agent is the callback sender.
/// @dev Callback authentication checks both the trusted proxy and the injected Reactive Agent ID.
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
    event GridSettled(uint256 indexed ruleId, uint32 indexed sequence);
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
    /// @notice Execution slippage tolerance changed by the owner.
    event SlippageChanged(uint16 slippageBps);

    /// @notice Default execution-time slippage tolerance: 0.50%.
    uint16 public constant DEFAULT_SLIPPAGE_BPS = 50;
    /// @notice Largest tolerance the owner may set: 10%. A wider floor is not a floor.
    uint16 public constant MAX_SLIPPAGE_BPS = 1_000;
    uint8 public constant EXECUTION_PAYLOAD_VERSION = 2;

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
    /// @notice Execution-time slippage tolerance applied to the live quote, in basis points.
    uint16 public slippageBps;

    mapping(address => uint256) private _principal;
    mapping(bytes32 => bool) private _mirroredExecutions;
    mapping(uint256 => uint32) private _executedSequence;

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
        slippageBps = DEFAULT_SLIPPAGE_BPS;
    }

    modifier onlyVaultOwner() {
        if (msg.sender != owner) revert NotOwner();
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

    /// @notice Sets the execution-time slippage tolerance, capped at `MAX_SLIPPAGE_BPS`.
    function setSlippageBps(uint16 bps) external onlyVaultOwner {
        if (bps > MAX_SLIPPAGE_BPS) revert InvalidSecondary();
        slippageBps = bps;
        emit SlippageChanged(bps);
    }

    /// @notice Owner's emergency stop for execution.
    function setPaused(bool paused_) external onlyVaultOwner {
        paused = paused_;
    }

    /// @notice Reactive callback entry point. The `agent` argument is compared, never trusted.
    /// @dev Money path. Alert templates are refused before any token call, transfers use
    /// `transfer`, the balance-floor template uses `transferFrom`, and swaps quote from live
    /// reserves — never from the Agent's cached price (FR-028).
    function execute(address agent_, uint256 ruleId, bytes calldata data) external nonReentrant {
        _authenticate(agent_);
        if (mirrorMode) revert MirrorDepthNotAllowed();
        if (paused) revert ConditionNotMet();
        if (ruleId > type(uint32).max) revert InvalidTemplateParams();

        ExecutionPayload memory payload = CallbackPayload.decode(data);
        if (payload.template > type(uint8).max) revert InvalidTemplateParams();
        uint8 template = uint8(payload.template);
        if (template < 1 || template > RuleLib.TEMPLATE_COUNT) revert UnknownTemplate(template);
        if (RuleLib.isAlertTemplate(template)) revert AlertOnlyTemplate(template);
        if (payload.amountIn == 0) revert InvalidAmount();
        if (payload.amountIn > maxSpendPerRun) {
            revert ExceedsPerRunCap(payload.amountIn, maxSpendPerRun);
        }
        if (payload.expiry == 0 || block.timestamp > payload.expiry) {
            revert Expired(ruleId, payload.expiry);
        }
        if (payload.tokenIn != allowedTokenIn) {
            revert TokenMismatch(allowedTokenIn, payload.tokenIn);
        }
        if (payload.sequence <= _executedSequence[ruleId]) {
            revert StaleExecution(ruleId, payload.sequence);
        }
        _executedSequence[ruleId] = payload.sequence;

        if (RuleLib.isSwapTemplate(template)) {
            if (payload.tokenOut != allowedTokenOut) {
                revert TokenMismatch(allowedTokenOut, payload.tokenOut);
            }
            _swap(ruleId, payload);
            if (template == 6) emit GridSettled(ruleId, payload.sequence);
        } else if (template == 9) {
            _pullFromSource(ruleId, payload);
        } else {
            _sendToRecipient(ruleId, payload);
        }
    }

    /// @notice Executes a proportional swap in a mirror vault with a live quote.
    function executeMirror(address agent_, uint256 ruleId, bytes calldata data)
        external
        nonReentrant
    {
        _authenticate(agent_);
        if (!mirrorMode) revert MirrorDepthNotAllowed();
        if (paused) revert ConditionNotMet();
        MirrorPayload memory payload = CallbackPayload.decodeMirror(data);
        if (payload.leaderVault == address(0) || payload.leaderVault == address(this)) {
            revert MirrorDepthNotAllowed();
        }
        if (payload.tokenIn != allowedTokenIn) {
            revert TokenMismatch(allowedTokenIn, payload.tokenIn);
        }
        if (payload.tokenOut != allowedTokenOut) {
            revert TokenMismatch(allowedTokenOut, payload.tokenOut);
        }
        if (payload.amountIn == 0 || payload.minOut == 0) revert InvalidAmount();
        if (payload.amountIn > maxSpendPerRun) {
            revert ExceedsPerRunCap(payload.amountIn, maxSpendPerRun);
        }
        uint256 available = _principal[allowedTokenIn];
        if (payload.amountIn > available) {
            revert InsufficientPrincipal(payload.amountIn, available);
        }
        bytes32 key = CallbackPayload.mirrorExecutionKey(
            payload.leaderVault, payload.leaderRuleId, payload.leaderTx
        );
        if (_mirroredExecutions[key]) revert DuplicateLeaderExecution(key);
        _mirroredExecutions[key] = true;

        (uint256 reserveIn, uint256 reserveOut,) = _liveReserves(payload.pair);
        uint256 expected = PriceMath.expectedOut(payload.amountIn, reserveIn, reserveOut);
        if (expected < payload.minOut) revert SlippageExceeded(payload.minOut, expected);
        uint256 liveMinimum = PriceMath.applySlippage(expected, slippageBps);
        _trade(payload.amountIn, liveMinimum > payload.minOut ? liveMinimum : payload.minOut);
        emit Mirrored(ruleId, payload.leaderVault, payload.leaderTx);
        _emitBalances(allowedTokenIn, allowedTokenOut);
    }

    /// @notice Principal recorded for `token`.
    function principalOf(address token) external view returns (uint256 amount) {
        amount = _principal[token];
    }

    /// @dev Swap path: re-check the price condition against live reserves, quote from those same
    /// reserves, take the floor the Agent decided on, then swap.
    function _swap(uint256 ruleId, ExecutionPayload memory payload) private {
        if (payload.pair == address(0)) revert InvalidTemplateParams();
        if (payload.template != 1 && payload.threshold == 0) revert InvalidThreshold();
        (uint256 reserveIn, uint256 reserveOut, uint256 price) = _liveReserves(payload.pair);
        if (!_conditionStillHolds(payload, price)) {
            revert ConditionNotMet();
        }

        uint256 expected = PriceMath.expectedOut(payload.amountIn, reserveIn, reserveOut);
        // The minimum comes from live reserves, never from the Agent's cached price.
        uint256 minOut = PriceMath.applySlippage(expected, slippageBps);
        if (minOut == 0) revert InvalidAmount();

        uint256 received = _trade(payload.amountIn, minOut);
        emit Executed(
            ruleId, allowedTokenIn, allowedTokenOut, payload.amountIn, received, block.timestamp
        );
        _emitBalances(allowedTokenIn, allowedTokenOut);
    }

    /// @dev Trades through the configured router and accounts for the actual token delta.
    function _trade(uint256 amountIn, uint256 minOut) private returns (uint256 received) {
        address[] memory path = new address[](2);
        path[0] = allowedTokenIn;
        path[1] = allowedTokenOut;

        uint256 balanceBefore = IERC20(allowedTokenOut).balanceOf(address(this));
        IERC20(allowedTokenIn).forceApprove(router, amountIn);
        try IUniswapV2Router02(router)
            .swapExactTokensForTokens(amountIn, minOut, path, address(this), block.timestamp) {
        // The router moved the tokens; the balance delta is the authoritative output.
        }
        catch {
            revert SlippageExceeded(minOut, 0);
        }
        received = IERC20(allowedTokenOut).balanceOf(address(this)) - balanceBefore;
        if (received < minOut) revert SlippageExceeded(minOut, received);

        _spendPrincipal(allowedTokenIn, amountIn);
        _principal[allowedTokenOut] += received;
    }

    /// @dev Personal transfer path: send `amountIn` of the allowlisted token to the recipient.
    function _sendToRecipient(uint256 ruleId, ExecutionPayload memory payload) private {
        address recipient = address(uint160(payload.extra));
        if (recipient == address(0)) revert InvalidTemplateParams();
        address token = allowedTokenIn;
        uint256 available = IERC20(token).balanceOf(address(this));
        if (payload.amountIn > available) {
            revert InsufficientPrincipal(payload.amountIn, available);
        }
        _safeTransfer(token, recipient, payload.amountIn);
        _spendPrincipal(token, payload.amountIn);
        emit Executed(ruleId, token, address(0), payload.amountIn, 0, block.timestamp);
        _emitBalances(token, allowedTokenOut);
    }

    /// @dev Balance-floor path: pull `amountIn` from the wallet that approved this vault once.
    function _pullFromSource(uint256 ruleId, ExecutionPayload memory payload) private {
        address source = address(uint160(payload.extra));
        if (source == address(0)) revert InvalidTemplateParams();
        address token = allowedTokenIn;
        if (IERC20(token).balanceOf(address(this)) >= payload.threshold) revert ConditionNotMet();
        try IERC20(token).transferFrom(source, address(this), payload.amountIn) returns (bool ok) {
            if (!ok) revert TransferFailed();
        } catch {
            revert TransferFailed();
        }
        _principal[token] += payload.amountIn;
        emit Deposited(token, payload.amountIn, source);
        emit Executed(ruleId, token, address(0), 0, payload.amountIn, block.timestamp);
        _emitBalances(token, allowedTokenOut);
    }

    /// @dev Reads the pair's live reserves in the vault's allowlist order and verifies the pair
    /// really is the canonical pool for the allowlisted tokens.
    function _liveReserves(address pair)
        private
        view
        returns (uint256 reserveIn, uint256 reserveOut, uint256 price)
    {
        address factory = IUniswapV2Router02(router).factory();
        if (IUniswapV2Factory(factory).getPair(allowedTokenIn, allowedTokenOut) != pair) {
            revert InvalidTemplateParams();
        }
        address token0 = IUniswapV2Pair(pair).token0();
        address token1 = IUniswapV2Pair(pair).token1();
        bool forward = token0 == allowedTokenIn && token1 == allowedTokenOut;
        bool reverse = token0 == allowedTokenOut && token1 == allowedTokenIn;
        if (!forward && !reverse) revert TokenMismatch(allowedTokenIn, token0);

        (uint112 raw0, uint112 raw1,) = IUniswapV2Pair(pair).getReserves();
        if (raw0 == 0 || raw1 == 0) revert InvalidAmount();
        reserveIn = forward ? raw0 : raw1;
        reserveOut = forward ? raw1 : raw0;
        price = PriceMath.usdcPerWeth(raw0, raw1);
    }

    function _conditionStillHolds(ExecutionPayload memory payload, uint256 price)
        private
        pure
        returns (bool)
    {
        uint16 template = payload.template;
        if (template == 2 || template == 3 || template == 5) return price <= payload.threshold;
        if (template == 4) return price >= payload.threshold;
        if (template == 6) return PriceMath.movedBy(price, payload.threshold, payload.extra);
        return true;
    }

    /// @dev Reduces recorded principal by `amount`, saturating at zero: tokens sent to the vault
    /// directly must not make a withdrawal revert.
    function _spendPrincipal(address token, uint256 amount) private {
        uint256 recorded = _principal[token];
        _principal[token] = amount >= recorded ? 0 : recorded - amount;
    }

    /// @dev Proxy-sender check followed by the payload's first-argument check.
    function _authenticate(address agent_) private view {
        if (!senders[msg.sender]) revert NotServiceProvider();
        if (agent_ != agent) revert CallbackSenderMismatch(agent, agent_);
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        try IERC20(token).transfer(to, amount) returns (bool ok) {
            if (!ok) revert TransferFailed();
        } catch {
            revert TransferFailed();
        }
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

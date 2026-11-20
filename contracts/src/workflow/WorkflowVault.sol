// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AbstractCallback} from "@reactive/abstract-base/AbstractCallback.sol";
import {ChainConfig} from "../chain/ChainConfig.sol";
import {PriceMath} from "../libraries/PriceMath.sol";
import {IUniswapV2Factory, IUniswapV2Pair, IUniswapV2Router02} from "../shared/UniswapV2.sol";
import {WorkflowProgram as WF} from "./WorkflowProgram.sol";

/// @notice Custodies testnet tokens and settles a path approved by the owner on both chains.
contract WorkflowVault is AbstractCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Authorization {
        bytes32 programHash;
        uint64 epoch;
        uint64 originAfter;
        bool enabled;
        bool cancelled;
        bool payment;
    }

    error Unauthorized();
    error InvalidAuthorization();
    error ExpiredRun();
    error PriceChanged();
    error CapExceeded();
    error InvalidAsset();
    error InvalidPool();

    event WorkflowAuthorized(bytes32 indexed workflowId, bytes32 indexed programHash, uint64 epoch);
    event WorkflowRevoked(bytes32 indexed workflowId, uint64 epoch, bool cancelled);
    event WorkflowOutcome(
        bytes32 indexed runId,
        bytes32 indexed workflowId,
        bytes32 indexed programHash,
        uint64 epoch,
        uint8 leaf,
        bool completed,
        bytes4 reason
    );
    event WorkflowStep(
        bytes32 indexed runId,
        uint8 indexed step,
        uint8 kind,
        uint256 amount,
        uint256 received,
        address recipient
    );

    address public immutable owner;
    address public immutable agent;
    bytes32 public paymentWorkflow;
    mapping(bytes32 => Authorization) public authorizations;
    mapping(bytes32 => bytes) private _programs;
    mapping(bytes32 => bool) private _finalized;
    mapping(bytes32 => bool) private _consumedPayments;

    constructor(address callbackProxy, address owner_, address agent_)
        AbstractCallback(callbackProxy)
    {
        if (owner_ == address(0) || agent_ == address(0)) revert InvalidAuthorization();
        owner = owner_;
        agent = agent_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function authorize(bytes32 id, uint64 epoch, bytes calldata encoded) external onlyOwner {
        Authorization storage auth = authorizations[id];
        if (id == bytes32(0) || auth.cancelled || epoch <= auth.epoch) {
            revert InvalidAuthorization();
        }
        WF.Program memory program = WF.validate(encoded, address(this));
        bool payment = program.trigger == WF.PAYMENT;
        if (payment && paymentWorkflow != bytes32(0) && paymentWorkflow != id) {
            revert InvalidAuthorization();
        }
        if (paymentWorkflow == id && !payment) paymentWorkflow = bytes32(0);
        if (payment) paymentWorkflow = id;
        bytes32 hash = keccak256(encoded);
        _programs[hash] = encoded;
        authorizations[id] = Authorization(hash, epoch, uint64(block.number), true, false, payment);
        emit WorkflowAuthorized(id, hash, epoch);
    }

    function revoke(bytes32 id, uint64 epoch, bool cancel) external onlyOwner {
        Authorization storage auth = authorizations[id];
        if (auth.epoch == 0 || auth.epoch != epoch || auth.cancelled) {
            revert InvalidAuthorization();
        }
        auth.enabled = false;
        auth.cancelled = cancel;
        if (paymentWorkflow == id) paymentWorkflow = bytes32(0);
        emit WorkflowRevoked(id, epoch, cancel);
    }

    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        ChainConfig.Config memory cfg = ChainConfig.unichainSepolia();
        if (token != cfg.usdc && token != cfg.weth) revert InvalidAsset();
        IERC20(token).safeTransfer(owner, amount);
    }

    function programByHash(bytes32 hash) external view returns (bytes memory) {
        return _programs[hash];
    }

    function executeWorkflow(address sender, bytes32 id, WF.Run calldata run)
        external
        nonReentrant
    {
        if (!senders[msg.sender] || sender != agent) revert Unauthorized();
        if (run.id != WF.runId(agent, id, run)) revert InvalidAuthorization();
        if (_finalized[run.id]) return;
        _finalized[run.id] = true;
        Authorization storage auth = authorizations[id];
        if (!auth.enabled || auth.epoch != run.epoch || auth.programHash != run.programHash) {
            _outcome(id, run, false, InvalidAuthorization.selector);
            return;
        }
        if (run.expiresAt == 0 || block.timestamp > run.expiresAt) {
            _outcome(id, run, false, ExpiredRun.selector);
            return;
        }
        if (
            run.originChainId == ChainConfig.UNICHAIN_SEPOLIA && run.originBlock <= auth.originAfter
        ) {
            _outcome(id, run, false, InvalidAuthorization.selector);
            return;
        }
        if (auth.payment) {
            bytes32 payment =
                keccak256(abi.encode(run.originChainId, run.originTransaction, run.originLogIndex));
            if (_consumedPayments[payment]) {
                _outcome(id, run, false, InvalidAuthorization.selector);
                return;
            }
            _consumedPayments[payment] = true;
        }

        // The inner call rolls back every step on failure. The outer call preserves the outcome.
        try this.settle{gas: gasleft() - gasleft() / 10}(run) {
            _outcome(id, run, true, bytes4(0));
        } catch (bytes memory data) {
            _outcome(id, run, false, data.length >= 4 ? bytes4(data) : bytes4(0));
        }
    }

    function _outcome(bytes32 id, WF.Run calldata run, bool completed, bytes4 reason) private {
        emit WorkflowOutcome(run.id, id, run.programHash, run.epoch, run.leaf, completed, reason);
    }

    function settle(WF.Run calldata run) external {
        if (msg.sender != address(this)) revert Unauthorized();
        WF.Program memory program = WF.decode(_programs[run.programHash]);
        if (WF.path(program, run.observed) != run.leaf) revert InvalidAuthorization();
        WF.Action[] memory actions = program.nodes[run.leaf].actions;
        if (actions.length == 0) revert InvalidAuthorization();

        ChainConfig.Config memory cfg = ChainConfig.unichainSepolia();
        if (program.trigger == WF.PRICE) {
            (uint112 usdcReserve, uint112 wethReserve) = _reserves(cfg);
            uint256 price = PriceMath.usdcPerWeth(usdcReserve, wethReserve);
            bool stillAcross = program.rising ? price >= program.target : price < program.target;
            if (!stillAcross || WF.path(program, price) != run.leaf) revert PriceChanged();
        }
        uint256 total;
        uint256[3] memory amounts;
        for (uint256 i; i < actions.length; ++i) {
            if (actions[i].kind == WF.ALERT) continue;
            amounts[i] = WF.amountFor(actions[i], run.observed);
            total += amounts[i];
        }
        if (total > program.spendLimit || (program.trigger == WF.PAYMENT && total > run.observed)) {
            revert CapExceeded();
        }
        for (uint8 i; i < actions.length; ++i) {
            WF.Action memory action = actions[i];
            uint256 received;
            address recipient = action.recipient;
            if (action.kind == WF.SEND) {
                IERC20(cfg.usdc).safeTransfer(recipient, amounts[i]);
            } else if (action.kind == WF.SWAP) {
                received = _swap(cfg, amounts[i], program.slippage, run.expiresAt);
                recipient = address(this);
            }
            emit WorkflowStep(run.id, i, action.kind, amounts[i], received, recipient);
        }
    }

    function _reserves(ChainConfig.Config memory cfg)
        private
        view
        returns (uint112 usdc, uint112 weth)
    {
        IUniswapV2Pair pair = IUniswapV2Pair(cfg.pair);
        (uint112 first, uint112 second,) = pair.getReserves();
        return pair.token0() == cfg.usdc ? (first, second) : (second, first);
    }

    function _swap(ChainConfig.Config memory cfg, uint256 amount, uint16 slippage, uint64 expiresAt)
        private
        returns (uint256 received)
    {
        IUniswapV2Router02 router = IUniswapV2Router02(cfg.router);
        if (IUniswapV2Factory(router.factory()).getPair(cfg.usdc, cfg.weth) != cfg.pair) {
            revert InvalidPool();
        }
        (uint112 usdc, uint112 weth) = _reserves(cfg);
        uint256 floor = PriceMath.applySlippage(PriceMath.expectedOut(amount, usdc, weth), slippage);
        if (floor == 0) revert InvalidPool();
        address[] memory path = new address[](2);
        path[0] = cfg.usdc;
        path[1] = cfg.weth;
        IERC20 token = IERC20(cfg.usdc);
        token.forceApprove(cfg.router, amount);
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amount, floor, path, address(this), expiresAt);
        token.forceApprove(cfg.router, 0);
        return amounts[1];
    }
}


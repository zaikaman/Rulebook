// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AbstractCallback} from "@reactive/abstract-base/AbstractCallback.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "./WorkflowProtocolsV2.sol";

/// @notice Enforces signed V2 limits and executes the selected workflow path atomically.
contract WorkflowVaultV2 is AbstractCallback, ReentrancyGuard, WorkflowProtocolsV2 {
    using SafeERC20 for IERC20;

    uint8 public constant CONFIRMED = 1;
    uint8 public constant SKIPPED = 2;
    uint8 public constant EXPIRED = 3;
    uint8 public constant FAILED = 4;
    uint8 public constant IN_GRACE_PERIOD = 6;
    uint8 private constant NO_PATH = type(uint8).max;
    uint64 public constant PAYOUT_GRACE = 24 hours;
    uint64 private constant PRICE_MAX_AGE = 1 hours;

    struct Authorization {
        bytes32 programHash;
        uint64 epoch;
        uint64 originAfter;
        bool active;
    }

    struct Memory {
        uint128 peak;
        uint128 referencePrice;
        uint64 lastCheckIn;
        uint64 activity;
        uint64 eligibleAt;
        uint64 positionBlock;
        uint64 positionIndex;
        bool closed;
    }

    struct Context {
        uint256 price;
        uint256 refillThreshold;
        bool dipAvailable;
        bool dip;
    }

    error Unauthorized();
    error InvalidAuthorization();
    error CapExceeded();
    error DuplicateOrigin();
    error StaleObservation();
    error SettlementInterrupted();

    event Authorized(bytes32 indexed workflow, bytes32 indexed programHash, uint64 epoch);
    event Revoked(bytes32 indexed workflow, uint64 epoch);
    event CheckIn(bytes32 indexed workflow, uint64 timestamp);
    event Closed(bytes32 indexed workflow, uint64 indexed epoch);
    event Outcome(
        bytes32 indexed workflow,
        bytes32 indexed runId,
        uint64 epoch,
        uint8 status,
        uint8 path,
        bytes4 reason
    );
    event Step(
        bytes32 indexed runId,
        uint8 indexed index,
        uint8 kind,
        uint256 spent,
        uint256 received,
        address account
    );
    event Observation(bytes32 indexed runId, uint256 value, address actor);

    address public immutable owner;
    address public immutable agent;
    uint32 public immutable chain;
    WorkflowProgramValidatorV2 public immutable validator;
    bytes32 public paymentWorkflow;
    mapping(bytes32 => Authorization) public authorizations;
    mapping(bytes32 => bytes) public programs;
    mapping(bytes32 => string) public titles;
    bytes32[] private knownWorkflows;
    mapping(bytes32 => Memory) public workflowMemory;
    mapping(bytes32 => uint8) public outcomes;
    mapping(bytes32 => bool) private consumedPayments;
    mapping(bytes32 => mapping(bytes32 => bool)) private consumedDips;

    constructor(
        address proxy,
        address owner_,
        address agent_,
        uint32 chain_,
        Networks memory cfg,
        WorkflowProgramValidatorV2 validator_
    ) AbstractCallback(proxy) WorkflowProtocolsV2(cfg) {
        if (
            proxy == address(0) || owner_ == address(0) || agent_ == address(0)
                || chain_ != P.UNICHAIN_SEPOLIA
        ) revert InvalidAuthorization();
        owner = owner_;
        agent = agent_;
        chain = chain_;
        validator = validator_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function workflowIds() external view returns (bytes32[] memory) {
        return knownWorkflows;
    }

    function authorize(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title
    ) external onlyOwner {
        P.Program memory program = validator.validateProgram(encoded);
        Authorization storage auth = authorizations[workflow];
        Memory storage memory_ = workflowMemory[workflow];
        if (
            workflow == bytes32(0) || epoch <= auth.epoch || program.chain != chain
                || bytes(title).length == 0 || bytes(title).length > 80 || memory_.closed
                || (program.expires != 0 && program.expires <= block.timestamp)
        ) revert InvalidAuthorization();
        if (program.trigger == P.PAYMENT) {
            if (paymentWorkflow != bytes32(0) && paymentWorkflow != workflow) {
                revert InvalidAuthorization();
            }
            paymentWorkflow = workflow;
        } else if (paymentWorkflow == workflow) {
            paymentWorkflow = bytes32(0);
        }
        bytes32 hash = keccak256(encoded);
        if (auth.epoch == 0) knownWorkflows.push(workflow);
        programs[hash] = encoded;
        titles[workflow] = title;
        // Keep the one-shot latch across workflow epochs.
        memory_.peak = 0;
        memory_.referencePrice = 0;
        memory_.eligibleAt = 0;
        memory_.lastCheckIn = uint64(block.timestamp);
        authorizations[workflow] = Authorization(hash, epoch, uint64(block.number), true);
        emit Authorized(workflow, hash, epoch);
    }

    function revoke(bytes32 workflow, uint64 epoch) external onlyOwner {
        Authorization storage auth = authorizations[workflow];
        if (!auth.active || auth.epoch != epoch) revert InvalidAuthorization();
        auth.active = false;
        if (paymentWorkflow == workflow) paymentWorkflow = bytes32(0);
        delete workflowMemory[workflow].eligibleAt;
        emit Revoked(workflow, epoch);
    }

    function checkIn(bytes32 workflow) external onlyOwner {
        if (!authorizations[workflow].active) revert InvalidAuthorization();
        Memory storage memory_ = workflowMemory[workflow];
        memory_.lastCheckIn = uint64(block.timestamp);
        memory_.eligibleAt = 0;
        emit CheckIn(workflow, memory_.lastCheckIn);
    }

    /// @notice Returns user-owned tokens or native execution credit even when workflow creation is disabled.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) _pay(payable(owner), amount);
        else IERC20(token).safeTransfer(owner, amount);
    }

    function execute(address sender, bytes32 workflow, P.Run calldata run) external nonReentrant {
        if (!senders[msg.sender] || sender != agent) revert Unauthorized();
        bytes32 runId = P.runId(agent, workflow, run);
        if (outcomes[runId] != 0) return;
        _attempt(workflow, run, runId);
    }

    function _attempt(bytes32 workflow, P.Run calldata run, bytes32 runId) private {
        Authorization memory auth = authorizations[workflow];
        if (
            !auth.active || auth.epoch != run.epoch || auth.programHash != run.programHash
                || (run.originChain == chain && run.originBlock <= auth.originAfter)
        ) {
            _outcome(workflow, runId, run.epoch, SKIPPED, NO_PATH, InvalidAuthorization.selector);
            return;
        }
        if (run.expiresAt == 0 || block.timestamp > run.expiresAt) {
            _outcome(workflow, runId, run.epoch, EXPIRED, NO_PATH, bytes4(0));
            return;
        }
        // Reserve gas to record the final outcome after settlement.
        uint256 gasForSettlement = gasleft() > 65_000 ? gasleft() - 65_000 : 0;
        try this.settle{gas: gasForSettlement}(workflow, run, runId) returns (
            uint8 status, uint8 path
        ) {
            _outcome(workflow, runId, run.epoch, status, path, bytes4(0));
        } catch (bytes memory data) {
            // An out-of-gas self-call returns no data. Let the outer call revert so it can be retried.
            if (data.length == 0) revert SettlementInterrupted();
            bytes4 reason = data.length >= 4 ? bytes4(data) : bytes4(0);
            uint8 status = reason == NoLongerEligible.selector
                || reason == StaleObservation.selector || reason == DuplicateOrigin.selector
                ? SKIPPED
                : FAILED;
            _outcome(workflow, runId, run.epoch, status, NO_PATH, reason);
        }
    }

    function _outcome(
        bytes32 workflow,
        bytes32 runId,
        uint64 epoch,
        uint8 status,
        uint8 path,
        bytes4 reason
    ) private {
        outcomes[runId] = status;
        emit Outcome(workflow, runId, epoch, status, path, reason);
    }

    /// @notice Evaluates and executes the current program. Only the isolated settlement call can enter.
    function settle(bytes32 workflow, P.Run calldata run, bytes32 runId)
        external
        returns (uint8, uint8)
    {
        if (msg.sender != address(this)) revert Unauthorized();
        P.Program memory program = abi.decode(programs[run.programHash], (P.Program));
        Memory storage memory_ = workflowMemory[workflow];
        if (program.expires != 0 && block.timestamp > program.expires) return (EXPIRED, NO_PATH);
        if (memory_.closed) return (SKIPPED, NO_PATH);

        Context memory ctx;
        if (run.observationId != bytes32(0)) {
            ctx.dipAvailable = !consumedDips[workflow][run.observationId];
        }
        if (program.trigger == P.PRICE) {
            if (
                run.observed == 0 || run.observed > type(uint128).max
                    || uint256(run.observationTime) + PRICE_MAX_AGE < block.timestamp
                    || run.originBlock < memory_.positionBlock
                    || (run.originBlock == memory_.positionBlock
                        && run.originLogIndex <= memory_.positionIndex)
            ) {
                revert StaleObservation();
            }
            memory_.positionBlock = run.originBlock;
            memory_.positionIndex = run.originLogIndex;
            if (run.observed > memory_.peak) memory_.peak = uint128(run.observed);
            if (run.high > memory_.peak && run.highBlock > authorizations[workflow].originAfter) {
                memory_.peak = run.high;
            }
            ctx.price = _price();
        }

        if (run.activityTime > memory_.activity) {
            memory_.activity = run.activityTime;
            memory_.eligibleAt = 0;
        }

        uint8 cursor;
        while (program.nodes[cursor].check != 0) {
            P.Node memory node = program.nodes[cursor];
            bool matched = _evaluate(program, node, run, memory_, ctx);
            cursor = matched ? node.yes : node.no;
        }
        P.Action[] memory actions = program.nodes[cursor].actions;
        if (actions.length == 0) {
            if (P.hasCheck(program, P.INACTIVITY)) memory_.eligibleAt = 0;
            return (SKIPPED, cursor);
        }

        P.Action memory first = actions[0];
        if (first.kind == P.INACTIVITY_PAYOUT) {
            if (memory_.eligibleAt == 0) {
                memory_.eligibleAt = uint64(block.timestamp) + PAYOUT_GRACE;
            }
            if (block.timestamp < memory_.eligibleAt) return (IN_GRACE_PERIOD, cursor);
        }

        bool spends = _spends(actions);
        if (program.trigger == P.PAYMENT && spends) {
            bytes32 origin =
                keccak256(abi.encode(run.originChain, run.originTransaction, run.originLogIndex));
            if (consumedPayments[origin]) revert DuplicateOrigin();
            consumedPayments[origin] = true;
        }
        _actions(program, run, runId, actions, memory_, ctx);
        if (ctx.dip) consumedDips[workflow][run.observationId] = true;
        if (program.once) {
            memory_.closed = true;
            authorizations[workflow].active = false;
            if (paymentWorkflow == workflow) paymentWorkflow = bytes32(0);
            emit Closed(workflow, run.epoch);
        }
        emit Observation(runId, ctx.price == 0 ? run.observed : ctx.price, run.actor);
        return (CONFIRMED, cursor);
    }

    function _spends(P.Action[] memory actions) private pure returns (bool) {
        for (uint256 index; index < actions.length; ++index) {
            if (actions[index].amount != 0) return true;
        }
        return false;
    }

    function _evaluate(
        P.Program memory program,
        P.Node memory node,
        P.Run calldata run,
        Memory storage memory_,
        Context memory ctx
    ) private returns (bool) {
        uint8 check = node.check;
        uint256 threshold = node.value;
        if (check == P.AMOUNT_AT_LEAST) return run.observed >= threshold;
        if (check == P.AMOUNT_ABOVE) return run.observed > threshold;
        if (check == P.PAYMENT_FROM) return run.actor == program.subject;
        if (check == P.USDC_BELOW) {
            bool result = IERC20(usdc).balanceOf(address(this)) < threshold;
            if (result) ctx.refillThreshold = threshold;
            return result;
        }
        if (check == P.INACTIVITY) {
            return block.timestamp >= Math.max(memory_.activity, memory_.lastCheckIn) + threshold;
        }
        if (ctx.price == 0) ctx.price = _price();
        uint256 price = ctx.price;
        if (check == P.PRICE_AT_LEAST) return price >= threshold;
        if (check == P.PRICE_AT_MOST) return price <= threshold;
        if (check == P.PRICE_BELOW) return price < threshold;
        if (check == P.PRICE_OUTSIDE) return price < threshold || price > node.upper;
        if (check == P.DIP_BY) {
            if (
                run.previous == 0 || !ctx.dipAvailable
                    || uint256(run.observationTime) + Math.min(PRICE_MAX_AGE, program.interval)
                        < block.timestamp
            ) return false;
            uint256 target = Math.mulDiv(run.previous, P.BPS - threshold, P.BPS);
            bool dipped = run.observed <= target && price <= target;
            ctx.dip = ctx.dip || dipped;
            return dipped;
        }
        if (check == P.PRICE_RISES_THROUGH) {
            return run.previous != 0 && run.previous < threshold && run.observed >= threshold
                && price >= threshold;
        }
        if (check == P.PRICE_FALLS_THROUGH) {
            return run.previous >= threshold && run.observed < threshold && price < threshold;
        }

        uint256 referencePrice = memory_.referencePrice;
        if (check == P.TRAILING) {
            referencePrice = memory_.peak;
        } else if (referencePrice == 0) {
            referencePrice = node.upper == 0 ? run.observed : node.upper;
            memory_.referencePrice = uint128(referencePrice);
        }
        if (check == P.ABOVE_REFERENCE) {
            return price >= Math.mulDiv(referencePrice, P.BPS + threshold, P.BPS);
        }
        return price <= Math.mulDiv(referencePrice, P.BPS - threshold, P.BPS);
    }

    function _actions(
        P.Program memory program,
        P.Run calldata run,
        bytes32 runId,
        P.Action[] memory actions,
        Memory storage memory_,
        Context memory ctx
    ) private {
        uint256 usdcSpent;
        uint256 wethSpent;
        for (uint8 index; index < actions.length; ++index) {
            P.Action memory action = actions[index];
            uint256 amount = action.unit == P.PERCENT
                ? Math.mulDiv(run.observed, action.amount, P.BPS)
                : action.amount;
            if (amount == 0 && action.kind != P.ALERT) {
                revert NoLongerEligible();
            }
            if (action.kind == P.SELL) {
                wethSpent += amount;
            } else if (action.kind == P.REFILL) {
                uint256 balance = IERC20(usdc).balanceOf(address(this));
                if (balance >= ctx.refillThreshold) revert NoLongerEligible();
                amount = Math.min(amount, ctx.refillThreshold - balance);
                usdcSpent += amount;
            } else {
                usdcSpent += amount;
            }

            if (
                usdcSpent > program.usdcCap || wethSpent > program.wethCap
                    || (program.trigger == P.PAYMENT && usdcSpent > run.observed)
            ) revert CapExceeded();

            uint256 received;
            address account = action.account;
            if (action.kind == P.SEND || action.kind == P.INACTIVITY_PAYOUT) {
                if (account == address(this)) revert InvalidAuthorization();
                IERC20(usdc).safeTransfer(account, amount);
            } else if (action.kind == P.BUY || action.kind == P.SELL) {
                received = _swap(action.kind == P.SELL, amount, program.slippage, run.expiresAt);
                account = address(this);
                if (program.trigger == P.PRICE) memory_.referencePrice = uint128(ctx.price);
            } else if (action.kind == P.REFILL) {
                IERC20(usdc).safeTransferFrom(owner, address(this), amount);
                account = address(this);
            }
            emit Step(runId, index, action.kind, amount, received, account);
        }
    }
}

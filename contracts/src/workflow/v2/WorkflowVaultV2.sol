// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AbstractCallback} from "@reactive/abstract-base/AbstractCallback.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";
import {ChainConfig} from "../../chain/ChainConfig.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";
import {WorkflowProtocolsV2} from "./WorkflowProtocolsV2.sol";

interface IVaultFactoryV2 {
    function approvedImplementation(address implementation) external view returns (bool);
}

/// @notice Enforces signed V2 limits and executes the selected workflow path atomically.
contract WorkflowVaultV2 is
    AbstractCallback,
    ReentrancyGuard,
    WorkflowProtocolsV2,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    uint8 public constant CONFIRMED = 1;
    uint8 public constant SKIPPED = 2;
    uint8 public constant EXPIRED = 3;
    uint8 public constant FAILED = 4;
    uint8 public constant IN_GRACE_PERIOD = 6;
    uint8 private constant NO_PATH = type(uint8).max;
    uint64 public constant PAYOUT_GRACE = 24 hours;
    uint64 private constant CALLBACK_LIFETIME = 10 minutes;
    uint64 private constant PRICE_MAX_AGE = 1 hours;
    uint64 private constant WEEK = 7 days;
    // Unix time zero is a Thursday. Monday 00:00 UTC therefore falls on a weekly remainder of
    // four days, which this shift removes before flooring to the start of the week.
    uint64 private constant MONDAY_SHIFT = 3 days;

    struct Authorization {
        bytes32 programHash;
        uint64 epoch;
        uint64 originAfter;
        bool active;
    }

    struct WeeklyBudget {
        uint96 usdcLimit;
        uint96 wethLimit;
        uint128 usdcSpent;
        uint128 wethSpent;
        uint64 weekStart;
        uint32 revision;
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
        bool swapped;
        bool referenceSeeded;
        MarketCache market;
    }

    error Unauthorized();
    error InvalidAuthorization();
    error StaleBudget();
    error CapExceeded();
    error WeeklyBudgetExceeded();
    error DuplicateOrigin();
    error StaleObservation();
    error SettlementInterrupted();
    error InsufficientVaultBalance(address asset, uint256 required, uint256 available);
    error InsufficientRefillAllowance(uint256 required, uint256 available);
    error InsufficientOwnerBalance(uint256 required, uint256 available);

    event Authorized(bytes32 indexed workflow, bytes32 indexed programHash, uint64 epoch);
    event WeeklyBudgetSet(
        bytes32 indexed workflow, uint96 usdcLimit, uint96 wethLimit, uint32 revision
    );
    event BudgetSynced(
        bytes32 indexed workflow,
        uint96 usdcLimit,
        uint96 wethLimit,
        uint128 usdcSpent,
        uint128 wethSpent,
        uint64 weekStart,
        uint32 revision
    );
    event Revoked(bytes32 indexed workflow, uint64 epoch);
    event CheckIn(bytes32 indexed workflow, uint64 timestamp);
    event Closed(bytes32 indexed workflow, uint64 indexed epoch);
    event GraceStarted(bytes32 indexed workflow, uint64 indexed epoch, uint64 eligibleAt);
    event ReferenceSynced(bytes32 indexed workflow, uint64 indexed epoch, uint128 referencePrice);
    event PeakSynced(bytes32 indexed workflow, uint64 indexed epoch, uint128 peak);
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

    address public immutable callbackProxy;
    uint32 public immutable chain;
    address public owner;
    address public agent;
    bytes32 public paymentWorkflow;
    mapping(bytes32 => Authorization) public authorizations;
    mapping(bytes32 => WeeklyBudget) private weeklyBudgets;
    mapping(bytes32 => bytes) public programs;
    mapping(bytes32 => string) public titles;
    bytes32[] private knownWorkflows;
    mapping(bytes32 => Memory) public workflowMemory;
    mapping(bytes32 => uint8) public outcomes;
    mapping(bytes32 => bool) private consumedPayments;
    mapping(bytes32 => mapping(bytes32 => bool)) private consumedDips;
    address public factory;
    mapping(bytes32 => uint64) public payoutReadyAt;
    uint256[49] private __gap;

    constructor(
        address proxy,
        address owner_,
        address agent_,
        uint32 chain_,
        Networks memory cfg,
        WorkflowProgramValidatorV2 validator_
    ) AbstractCallback(proxy) WorkflowProtocolsV2(cfg, validator_) {
        if (
            proxy == address(0) || (owner_ == address(0)) != (agent_ == address(0))
                || !P.isFundsChain(chain_)
        ) revert InvalidAuthorization();
        if (
            ChainConfig.isMainnetFundsChain(chain_)
                && (cfg.router == address(0)
                    || cfg.pair == address(0)
                    || cfg.ethUsdFeed == address(0)
                    || cfg.sequencerFeed == address(0)
                    || !marketVerified)
        ) revert InvalidMarket();
        callbackProxy = proxy;
        chain = chain_;
        if (owner_ != address(0)) {
            factory = msg.sender;
            owner = owner_;
            agent = agent_;
        } else {
            // Lock the implementation contract so it can never be initialized directly.
            owner = address(1);
        }
    }

    function initialize(address owner_, address agent_) external {
        if (owner != address(0) || owner_ == address(0) || agent_ == address(0)) {
            revert InvalidAuthorization();
        }
        factory = msg.sender;
        owner = owner_;
        agent = agent_;
        _syncCallbackProxy(callbackProxy);
    }

    /// @notice Updates the Reactive payment ACL after an implementation changes the callback proxy.
    function syncCallbackProxy() external onlyOwner {
        _syncCallbackProxy(callbackProxy);
    }

    function _syncCallbackProxy(address next) private {
        address previous = address(vendor);
        if (previous == next) return;
        if (previous != address(0)) removeAuthorizedSender(previous);
        vendor = IPayable(payable(next));
        addAuthorizedSender(next);
    }

    function _authorizeUpgrade(address newImplementation) internal override {
        if (msg.sender != owner) revert Unauthorized();
        if (
            factory == address(0)
                || !IVaultFactoryV2(factory).approvedImplementation(newImplementation)
        ) {
            revert InvalidAuthorization();
        }
        address nextProxy = WorkflowVaultV2(payable(newImplementation)).callbackProxy();
        if (nextProxy.code.length == 0) revert InvalidAuthorization();
        _syncCallbackProxy(nextProxy);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function workflowIds() external view returns (bytes32[] memory) {
        return knownWorkflows;
    }

    /// @notice Returns the current week's limits, spend, remaining amounts, reset, and revision.
    /// @dev A zero limit is unlimited. Spend is reported as zero once the week has rolled over,
    /// even before the next settlement writes the new week start.
    function weeklyBudget(bytes32 workflow)
        external
        view
        returns (
            uint96 usdcLimit,
            uint96 wethLimit,
            uint128 usdcSpent,
            uint128 wethSpent,
            uint128 usdcRemaining,
            uint128 wethRemaining,
            uint64 resetsAt,
            uint32 revision
        )
    {
        WeeklyBudget storage budget = weeklyBudgets[workflow];
        uint64 start = _weekStart(block.timestamp);
        usdcLimit = budget.usdcLimit;
        wethLimit = budget.wethLimit;
        revision = budget.revision;
        resetsAt = start + WEEK;
        if (budget.weekStart == start) {
            usdcSpent = budget.usdcSpent;
            wethSpent = budget.wethSpent;
        }
        usdcRemaining = _remaining(usdcLimit, usdcSpent);
        wethRemaining = _remaining(wethLimit, wethSpent);
    }

    function authorize(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title
    ) external onlyOwner {
        _authorize(workflow, epoch, encoded, title);
    }

    /// @notice Authorizes a program and stages its weekly limits in one transaction.
    function authorizeWithWeeklyBudget(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title,
        uint96 usdcLimit,
        uint96 wethLimit
    ) external onlyOwner {
        _authorize(workflow, epoch, encoded, title);
        _writeBudget(workflow, usdcLimit, wethLimit);
    }

    /// @notice Changes only the weekly limits. The schedule and inactivity window are untouched.
    /// @dev `expectedEpoch` and `expectedRevision` reject an edit prepared before a newer
    /// authorization or budget change confirmed.
    function setWeeklyBudget(
        bytes32 workflow,
        uint64 expectedEpoch,
        uint32 expectedRevision,
        uint96 usdcLimit,
        uint96 wethLimit
    ) external onlyOwner {
        if (authorizations[workflow].epoch != expectedEpoch || expectedEpoch == 0) {
            revert InvalidAuthorization();
        }
        if (weeklyBudgets[workflow].revision != expectedRevision) revert StaleBudget();
        _writeBudget(workflow, usdcLimit, wethLimit);
    }

    function _authorize(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title
    ) private {
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
        // Keep the one-shot latch across workflow epochs, but clear the origin price cursor so
        // switching to a lower-block origin chain never trips StaleObservation.
        memory_.positionBlock = 0;
        memory_.positionIndex = 0;
        memory_.peak = 0;
        memory_.referencePrice = 0;
        memory_.eligibleAt = 0;
        delete payoutReadyAt[workflow];
        memory_.lastCheckIn = uint64(block.timestamp);
        authorizations[workflow] = Authorization(hash, epoch, uint64(block.number), true);
        // Start the first budget week when the workflow is first authorized.
        if (weeklyBudgets[workflow].weekStart == 0) {
            weeklyBudgets[workflow].weekStart = _weekStart(block.timestamp);
        }
        emit Authorized(workflow, hash, epoch);
    }

    function _writeBudget(bytes32 workflow, uint96 usdcLimit, uint96 wethLimit) private {
        WeeklyBudget storage budget = weeklyBudgets[workflow];
        bool hadLimit = budget.usdcLimit != 0 || budget.wethLimit != 0;
        uint64 start = _weekStart(block.timestamp);
        if (budget.weekStart != start) {
            budget.weekStart = start;
            budget.usdcSpent = 0;
            budget.wethSpent = 0;
        }
        budget.usdcLimit = usdcLimit;
        budget.wethLimit = wethLimit;
        budget.revision += 1;
        emit WeeklyBudgetSet(workflow, usdcLimit, wethLimit, budget.revision);
        if (hadLimit || usdcLimit != 0 || wethLimit != 0) {
            _syncBudget(workflow);
        }
    }

    /// @notice Publishes the effective weekly budget so the Agent can refuse futile dispatches.
    /// @dev Mirrors `weeklyBudget`, including the read-through reset: a week that has rolled over
    /// reports zero spend before the next settlement writes the new week start. Every value is
    /// therefore a lower bound of the Vault's own state, which lets the Agent gate on it without
    /// ever hiding a run this Vault would settle.
    function _syncBudget(bytes32 workflow) private {
        WeeklyBudget storage budget = weeklyBudgets[workflow];
        uint64 start = _weekStart(block.timestamp);
        bool current = budget.weekStart == start;
        emit BudgetSynced(
            workflow,
            budget.usdcLimit,
            budget.wethLimit,
            current ? budget.usdcSpent : 0,
            current ? budget.wethSpent : 0,
            start,
            budget.revision
        );
    }

    /// @notice Monday 00:00 UTC at or before `timestamp`.
    /// @dev Timestamps before the first Monday of the Unix epoch have no earlier Monday; they
    /// share week zero rather than underflowing.
    function _weekStart(uint256 timestamp) private pure returns (uint64) {
        uint256 remainder = (timestamp + MONDAY_SHIFT) % WEEK;
        return uint64(timestamp >= remainder ? timestamp - remainder : 0);
    }

    function _remaining(uint96 limit, uint128 spent) private pure returns (uint128) {
        if (limit == 0 || spent >= limit) return 0;
        return uint128(limit) - spent;
    }

    function revoke(bytes32 workflow, uint64 epoch) external onlyOwner {
        Authorization storage auth = authorizations[workflow];
        if (!auth.active || auth.epoch != epoch) revert InvalidAuthorization();
        auth.active = false;
        if (paymentWorkflow == workflow) paymentWorkflow = bytes32(0);
        delete workflowMemory[workflow].eligibleAt;
        delete payoutReadyAt[workflow];
        emit Revoked(workflow, epoch);
    }

    function checkIn(bytes32 workflow) external onlyOwner {
        Authorization storage auth = authorizations[workflow];
        if (!auth.active) revert InvalidAuthorization();
        P.Program memory program = abi.decode(programs[auth.programHash], (P.Program));
        if (!P.hasCheck(program, P.INACTIVITY)) revert InvalidAuthorization();
        Memory storage memory_ = workflowMemory[workflow];
        memory_.lastCheckIn = uint64(block.timestamp);
        memory_.eligibleAt = 0;
        delete payoutReadyAt[workflow];
        emit CheckIn(workflow, memory_.lastCheckIn);
    }

    /// @notice Returns user-owned tokens or native execution credit even when workflow creation is disabled.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) _pay(payable(owner), amount);
        else IERC20(token).safeTransfer(owner, amount);
    }

    function execute(address sender, bytes32 workflow, P.Run calldata run) external nonReentrant {
        if (msg.sender != callbackProxy || sender != agent) revert Unauthorized();
        bytes32 runId = P.runId(agent, workflow, run);
        if (outcomes[runId] != 0) return;
        _attempt(workflow, run, runId);
    }

    /// @notice Forwards wallet activity independently of any in-flight payout run.
    function recordActivity(address sender, bytes32 workflow, uint64 epoch, uint64 activityTime)
        external
    {
        if (msg.sender != callbackProxy || sender != agent) revert Unauthorized();
        Authorization storage auth = authorizations[workflow];
        if (auth.active && auth.epoch == epoch) _recordActivity(workflow, activityTime);
    }

    function _recordActivity(bytes32 workflow, uint64 activityTime) private {
        Memory storage memory_ = workflowMemory[workflow];
        if (activityTime <= memory_.activity) return;
        memory_.activity = activityTime;
        if (activityTime > memory_.lastCheckIn) {
            memory_.eligibleAt = 0;
            delete payoutReadyAt[workflow];
        }
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
            // A shortfall is a funding precondition, not a broken workflow: the run did not settle,
            // nothing was spent, and the owner can restore it by topping up the Vault.
            uint8 status = reason == NoLongerEligible.selector
                || reason == StaleObservation.selector || reason == DuplicateOrigin.selector
                || reason == WeeklyBudgetExceeded.selector
                || reason == InsufficientVaultBalance.selector
                || reason == InsufficientRefillAllowance.selector
                || reason == InsufficientOwnerBalance.selector
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
        WeeklyBudget storage budget = weeklyBudgets[workflow];
        if (
            !workflowMemory[workflow].closed && (budget.usdcLimit != 0 || budget.wethLimit != 0)
                && (status == CONFIRMED || reason == WeeklyBudgetExceeded.selector)
        ) {
            _syncBudget(workflow);
        }
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
        if (program.trigger == P.PAYMENT && run.actor == owner) revert NoLongerEligible();

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
            _guardOraclePrice(ctx.market, run.observed);
            ctx.price = program.originChain == chain ? _price(ctx.market) : run.observed;
            if (
                ctx.price > memory_.peak
                    && _isPeakOracleConsistent(ctx.market, ctx.price, memory_.lastCheckIn, 0)
            ) {
                memory_.peak = _toUint128Price(ctx.price);
            }
            if (run.high > memory_.peak) {
                if (
                    _isPeakOracleConsistent(
                            ctx.market,
                            run.high,
                            memory_.lastCheckIn,
                            uint64(uint256(run.observationId))
                        )
                        && (run.originChain != chain
                            || run.highBlock > authorizations[workflow].originAfter)
                ) {
                    memory_.peak = run.high;
                } else {
                    emit PeakSynced(workflow, run.epoch, memory_.peak);
                }
            }
        }

        if (run.activityTime != 0) _recordActivity(workflow, run.activityTime);

        uint8 cursor;
        bool crossingRequired = program.trigger == P.PRICE && P.requiresCrossing(run);
        while (program.nodes[cursor].check != 0) {
            P.Node memory node = program.nodes[cursor];
            bool matched = _evaluate(program, node, run, memory_, ctx);
            if (
                matched
                    && (node.check == P.PRICE_RISES_THROUGH || node.check == P.PRICE_FALLS_THROUGH)
            ) {
                crossingRequired = false;
            }
            cursor = matched ? node.yes : node.no;
        }
        if (crossingRequired) revert NoLongerEligible();
        P.Action[] memory actions = program.nodes[cursor].actions;
        if (actions.length == 0) {
            if (P.hasCheck(program, P.INACTIVITY)) {
                memory_.eligibleAt = 0;
                delete payoutReadyAt[workflow];
            }
            if (ctx.referenceSeeded) {
                emit ReferenceSynced(workflow, run.epoch, memory_.referencePrice);
            }
            return (SKIPPED, cursor);
        }

        P.Action memory first = actions[0];
        if (first.kind == P.INACTIVITY_PAYOUT) {
            if (!_payoutReady(workflow, memory_, run)) return (IN_GRACE_PERIOD, cursor);
        }

        bool spends = _spends(actions);
        if (program.trigger == P.PAYMENT && spends) {
            bytes32 origin =
                keccak256(abi.encode(run.originChain, run.originTransaction, run.originLogIndex));
            if (consumedPayments[origin]) revert DuplicateOrigin();
            consumedPayments[origin] = true;
        }
        _actions(_settlementBudget(workflow), program, run, runId, actions, ctx);
        if (program.trigger == P.PRICE) {
            memory_.positionBlock = run.originBlock;
            memory_.positionIndex = run.originLogIndex;
        }
        if (ctx.swapped) {
            uint128 refPrice = _toUint128Price(ctx.price);
            memory_.referencePrice = refPrice;
            if (
                !program.once
                    && (P.hasCheck(program, P.ABOVE_REFERENCE)
                        || P.hasCheck(program, P.BELOW_REFERENCE))
            ) {
                emit ReferenceSynced(workflow, run.epoch, refPrice);
            }
        } else if (ctx.referenceSeeded && !program.once) {
            emit ReferenceSynced(workflow, run.epoch, memory_.referencePrice);
        }
        if (ctx.dip) {
            memory_.referencePrice = _toUint128Price(ctx.price);
            if (run.observationId != bytes32(0)) {
                consumedDips[workflow][run.observationId] = true;
            }
        }
        if (program.once) {
            if (first.kind == P.INACTIVITY_PAYOUT) delete payoutReadyAt[workflow];
            memory_.closed = true;
            authorizations[workflow].active = false;
            if (paymentWorkflow == workflow) paymentWorkflow = bytes32(0);
            emit Closed(workflow, run.epoch);
        }
        emit Observation(
            runId,
            ctx.price == 0 ? run.observed : ctx.price,
            program.trigger == P.PRICE ? address(0) : run.actor
        );
        return (CONFIRMED, cursor);
    }

    function _payoutReady(bytes32 workflow, Memory storage memory_, P.Run calldata run)
        private
        returns (bool)
    {
        uint64 eligibleAt = memory_.eligibleAt;
        if (eligibleAt == 0) {
            eligibleAt = uint64(block.timestamp) + PAYOUT_GRACE;
            memory_.eligibleAt = eligibleAt;
        }
        uint64 dispatchedAt =
            run.expiresAt >= CALLBACK_LIFETIME ? run.expiresAt - CALLBACK_LIFETIME : 0;
        uint64 readyAt = payoutReadyAt[workflow];
        if (readyAt != 0) {
            if (block.timestamp >= readyAt && dispatchedAt >= readyAt) return true;
            emit GraceStarted(workflow, run.epoch, readyAt);
        } else if (block.timestamp >= eligibleAt && dispatchedAt >= eligibleAt) {
            readyAt = uint64(block.timestamp) + CALLBACK_LIFETIME;
            payoutReadyAt[workflow] = readyAt;
            emit GraceStarted(workflow, run.epoch, readyAt);
        } else {
            emit GraceStarted(workflow, run.epoch, eligibleAt);
        }
        return false;
    }

    function _spends(P.Action[] memory actions) private pure returns (bool) {
        for (uint256 index; index < actions.length; ++index) {
            if (actions[index].amount != 0) return true;
        }
        return false;
    }

    /// @notice True when `run.observed` carries a remote origin-chain price rather than a
    /// transfer or payment amount.
    function _usesOriginPrice(P.Program memory program) private view returns (bool) {
        return program.originChain != chain
            && (program.trigger == P.PRICE || program.trigger == P.SCHEDULE);
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
        if (ctx.price == 0) {
            if (_usesOriginPrice(program)) {
                if (
                    program.trigger == P.SCHEDULE
                        && (run.observed == 0
                            || uint256(run.observationTime)
                                    + Math.min(PRICE_MAX_AGE, program.interval) < block.timestamp)
                ) revert StaleObservation();
                ctx.price = run.observed;
                if (ctx.price != 0) _guardOraclePrice(ctx.market, ctx.price);
            } else {
                ctx.price = _price(ctx.market);
            }
        }
        if (ctx.price == 0) return false;
        if (check == P.DIP_BY && _usesOriginPrice(program) && !ctx.dipAvailable) return false;
        uint256 price = ctx.price;
        if (check == P.PRICE_AT_LEAST) return price >= threshold;
        if (check == P.PRICE_AT_MOST) return price <= threshold;
        if (check == P.PRICE_BELOW) return price < threshold;
        if (check == P.PRICE_OUTSIDE) return price < threshold || price > node.upper;
        if (check == P.DIP_BY) {
            uint256 baseline = memory_.referencePrice;
            if (baseline == 0) {
                memory_.referencePrice = _toUint128Price(price);
                return false;
            }
            uint256 target = Math.mulDiv(baseline, P.BPS - threshold, P.BPS);
            bool dipped = price <= target;
            if (dipped) {
                ctx.dip = true;
            } else if (price > baseline) {
                memory_.referencePrice = _toUint128Price(price);
            }
            return dipped;
        }
        if (check == P.PRICE_RISES_THROUGH) {
            uint256 low = P.crossingLow(run);
            return low != 0 && low < threshold && run.observed >= threshold && price >= threshold;
        }
        if (check == P.PRICE_FALLS_THROUGH) {
            return P.crossingHigh(run) >= threshold && run.observed < threshold && price < threshold;
        }

        uint256 referencePrice = memory_.referencePrice;
        if (check == P.TRAILING) {
            referencePrice = memory_.peak;
        } else if (referencePrice == 0) {
            referencePrice = node.upper == 0 ? run.observed : node.upper;
            memory_.referencePrice = _toUint128Price(referencePrice);
            ctx.referenceSeeded = true;
        }
        if (check == P.ABOVE_REFERENCE) {
            return price >= Math.mulDiv(referencePrice, P.BPS + threshold, P.BPS);
        }
        return price <= Math.mulDiv(referencePrice, P.BPS - threshold, P.BPS);
    }

    function _actions(
        WeeklyBudget storage budget,
        P.Program memory program,
        P.Run calldata run,
        bytes32 runId,
        P.Action[] memory actions,
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
                if (budget.wethLimit != 0 && budget.wethSpent + wethSpent > budget.wethLimit) {
                    revert WeeklyBudgetExceeded();
                }
            } else {
                if (action.kind == P.REFILL) {
                    uint256 balance = IERC20(usdc).balanceOf(address(this));
                    if (balance >= ctx.refillThreshold) revert NoLongerEligible();
                    uint256 needed = Math.min(amount, ctx.refillThreshold - balance);
                    if (budget.usdcLimit != 0) {
                        uint256 spentTotal = budget.usdcSpent + usdcSpent;
                        if (spentTotal >= budget.usdcLimit) revert WeeklyBudgetExceeded();
                        needed = Math.min(needed, uint256(budget.usdcLimit) - spentTotal);
                    }
                    uint256 allowed = IERC20(usdc).allowance(owner, address(this));
                    if (allowed == 0) revert InsufficientRefillAllowance(needed, 0);
                    uint256 ownerBalance = IERC20(usdc).balanceOf(owner);
                    if (ownerBalance == 0) revert InsufficientOwnerBalance(needed, 0);
                    amount = Math.min(needed, Math.min(allowed, ownerBalance));
                }
                usdcSpent += amount;
                if (
                    action.kind != P.ALERT && budget.usdcLimit != 0
                        && budget.usdcSpent + usdcSpent > budget.usdcLimit
                ) {
                    revert WeeklyBudgetExceeded();
                }
            }

            if (
                usdcSpent > program.usdcCap || wethSpent > program.wethCap
                    || (program.trigger == P.PAYMENT && usdcSpent > run.observed)
            ) revert CapExceeded();

            _execute(program, run, runId, action, amount, index, ctx);
        }
        // Commit only after every action succeeded. A revert above rolls the whole run back.
        if (usdcSpent != 0) budget.usdcSpent = uint128(budget.usdcSpent + usdcSpent);
        if (wethSpent != 0) budget.wethSpent = uint128(budget.wethSpent + wethSpent);
    }

    function _execute(
        P.Program memory program,
        P.Run calldata run,
        bytes32 runId,
        P.Action memory action,
        uint256 amount,
        uint8 index,
        Context memory ctx
    ) private {
        uint256 received;
        address account = action.account;
        if (action.kind == P.SEND || action.kind == P.INACTIVITY_PAYOUT) {
            if (account == address(this)) revert InvalidAuthorization();
            _requireBalance(usdc, amount);
            IERC20(usdc).safeTransfer(account, amount);
        } else if (action.kind == P.BUY || action.kind == P.SELL) {
            _requireBalance(action.kind == P.SELL ? weth : usdc, amount);
            uint256 referencePrice = _usesOriginPrice(program) ? ctx.price : 0;
            received = _swap(
                ctx.market,
                action.kind == P.SELL,
                amount,
                program.slippage,
                run.expiresAt,
                referencePrice
            );
            account = address(this);
            if (program.trigger == P.PRICE) ctx.swapped = true;
        } else if (action.kind == P.REFILL) {
            IERC20(usdc).safeTransferFrom(owner, address(this), amount);
            account = address(this);
        }
        _step(runId, index, action.kind, amount, received, account);
    }

    /// @notice Refuses a transfer or swap the Vault cannot fund, before the token does.
    /// @dev USDC reverts with a string, which the outcome layer cannot classify. Checking the
    /// Vault's own live balance names the shortfall, and reading it per step keeps a path that
    /// funds a later step from an earlier fill valid.
    function _requireBalance(address asset, uint256 amount) private view {
        uint256 available = IERC20(asset).balanceOf(address(this));
        if (available < amount) revert InsufficientVaultBalance(asset, amount, available);
    }

    function _step(
        bytes32 runId,
        uint8 index,
        uint8 kind,
        uint256 amount,
        uint256 received,
        address account
    ) private {
        emit Step(runId, index, kind, amount, received, account);
    }

    function _toUint128Price(uint256 price) private pure returns (uint128) {
        if (price == 0 || price > type(uint128).max) revert InvalidMarket();
        return uint128(price);
    }

    function _settlementBudget(bytes32 workflow) private returns (WeeklyBudget storage budget) {
        budget = weeklyBudgets[workflow];
        uint64 start = _weekStart(block.timestamp);
        if (budget.weekStart != start) {
            budget.weekStart = start;
            budget.usdcSpent = 0;
            budget.wethSpent = 0;
        }
    }
}

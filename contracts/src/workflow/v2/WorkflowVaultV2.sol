// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";
import {ChainConfig} from "../../chain/ChainConfig.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";

import {WorkflowVaultStorageV2} from "./WorkflowVaultStorageV2.sol";
import {WorkflowVaultSettlementV2} from "./WorkflowVaultSettlementV2.sol";

interface IVaultFactoryV2 {
    function approvedImplementation(address implementation) external view returns (bool);
}

/// @notice Enforces signed V2 limits and executes the selected workflow path atomically.
contract WorkflowVaultV2 is WorkflowVaultStorageV2, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    address public immutable settlementModule;

    constructor(
        address proxy,
        address owner_,
        address agent_,
        uint32 chain_,
        Networks memory cfg,
        WorkflowProgramValidatorV2 validator_
    ) WorkflowVaultStorageV2(proxy, chain_, cfg, validator_) {
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
        settlementModule = address(new WorkflowVaultSettlementV2(proxy, chain_, cfg, validator_));
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

    /// @notice Corrects the Agent binding and invalidates every authorization from the old Agent.
    function rebindAgent(address nextAgent) external onlyOwner {
        address previous = agent;
        if (nextAgent == address(0) || nextAgent == previous) revert InvalidAuthorization();
        ++agentGeneration;
        agent = nextAgent;
        delete paymentWorkflow;
        emit AgentRebound(previous, nextAgent);
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
        WorkflowVaultV2 next = WorkflowVaultV2(payable(newImplementation));
        if (next.authorizationStorageVersion() == 0) revert InvalidAuthorization();
        address nextProxy = next.callbackProxy();
        if (nextProxy.code.length == 0) revert InvalidAuthorization();
        _syncCallbackProxy(nextProxy);
    }

    function authorizationStorageVersion() external pure returns (uint256) {
        return 1;
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
        if (_authorizations[workflow].epoch != expectedEpoch || expectedEpoch == 0) {
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
        Authorization storage auth = _authorizations[workflow];
        Memory storage memory_ = workflowMemory[workflow];
        if (
            workflow == bytes32(0) || epoch <= auth.epoch || program.chain != chain
                || bytes(title).length == 0 || bytes(title).length > 80 || memory_.closed
                || (program.expires != 0 && program.expires <= block.timestamp)
        ) revert InvalidAuthorization();
        if (program.trigger == P.PAYMENT) {
            if (paymentWorkflow != bytes32(0) && paymentWorkflow != workflow) {
                Authorization storage existing = _authorizations[paymentWorkflow];
                if (_isAuthorized(paymentWorkflow, existing)) {
                    uint64 existingExpires =
                        abi.decode(programs[existing.programHash], (P.Program)).expires;
                    if (existingExpires == 0 || block.timestamp <= existingExpires) {
                        revert InvalidAuthorization();
                    }
                    existing.active = false;
                }
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
        _authorizations[workflow] = Authorization(hash, epoch, uint64(block.number), true);
        authorizationGeneration[workflow] = agentGeneration;
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
    function _remaining(uint96 limit, uint128 spent) private pure returns (uint128) {
        if (limit == 0 || spent >= limit) return 0;
        return uint128(limit) - spent;
    }

    function revoke(bytes32 workflow, uint64 epoch) external onlyOwner {
        Authorization storage auth = _authorizations[workflow];
        if (!_isAuthorized(workflow, auth) || auth.epoch != epoch) revert InvalidAuthorization();
        auth.active = false;
        if (paymentWorkflow == workflow) paymentWorkflow = bytes32(0);
        delete workflowMemory[workflow].eligibleAt;
        delete payoutReadyAt[workflow];
        emit Revoked(workflow, epoch);
    }

    function checkIn(bytes32 workflow) external onlyOwner {
        Authorization storage auth = _authorizations[workflow];
        if (!_isAuthorized(workflow, auth)) revert InvalidAuthorization();
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
        bytes32 originId = P.runId(agent, workflow, run);
        bytes32 runId = originId;
        uint64 nonce = P.retryNonce(run);
        if (nonce != 0) {
            if (retryDeadline[originId] != nonce || run.expiresAt <= nonce) {
                return;
            }
            runId = P.retryRunId(originId, nonce);
        }
        if (outcomes[runId] != 0) return;
        _attempt(workflow, run, originId, runId);
    }

    /// @notice Forwards wallet activity independently of any in-flight payout run.
    function recordActivity(address sender, bytes32 workflow, uint64 epoch, uint64 activityTime)
        external
    {
        if (msg.sender != callbackProxy || sender != agent) revert Unauthorized();
        Authorization storage auth = _authorizations[workflow];
        if (_isAuthorized(workflow, auth) && auth.epoch == epoch) {
            _recordActivity(workflow, activityTime);
        }
    }

    function _attempt(bytes32 workflow, P.Run calldata run, bytes32 originId, bytes32 runId)
        private
    {
        Authorization storage auth = _authorizations[workflow];
        if (
            !_isAuthorized(workflow, auth) || auth.epoch != run.epoch
                || auth.programHash != run.programHash
                || (run.originChain == chain && run.originBlock <= auth.originAfter)
        ) {
            delete retryDeadline[originId];
            _outcome(workflow, runId, run.epoch, SKIPPED, NO_PATH, InvalidAuthorization.selector);
            return;
        }
        if (run.expiresAt == 0 || block.timestamp > run.expiresAt) {
            _outcome(workflow, runId, run.epoch, EXPIRED, NO_PATH, bytes4(0));
            return;
        }
        // Reserve gas to record the final outcome after settlement.
        uint256 gasForSettlement = gasleft() > 90_000 ? gasleft() - 90_000 : 0;
        try this.settle{gas: gasForSettlement}(workflow, run, runId) returns (
            uint8 status, uint8 path
        ) {
            delete retryDeadline[originId];
            _outcome(workflow, runId, run.epoch, status, path, bytes4(0));
        } catch (bytes memory data) {
            // An out-of-gas self-call returns no data. Let the outer call revert so it can be retried.
            if (data.length == 0) revert SettlementInterrupted();
            bytes4 reason = data.length >= 4 ? bytes4(data) : bytes4(0);
            // A shortfall is a funding precondition, not a broken workflow: the run did not settle,
            // nothing was spent, and the owner can restore it by topping up the Vault.
            uint8 status = reason == NoLongerEligible.selector
                || reason == StaleObservation.selector || reason == DuplicateOrigin.selector
                || reason == CrossingAlreadySettled.selector
                || reason == WeeklyBudgetExceeded.selector
                || reason == InsufficientVaultBalance.selector
                || reason == InsufficientRefillAllowance.selector
                || reason == InsufficientOwnerBalance.selector
                ? SKIPPED
                : FAILED;
            _outcome(workflow, runId, run.epoch, status, NO_PATH, reason);
            if (reason == WeeklyBudgetExceeded.selector && P.isFundsChain(run.originChain)) {
                uint8 trigger = abi.decode(programs[run.programHash], (P.Program)).trigger;
                if (trigger == P.PAYMENT || trigger == P.TRANSFER) {
                    retryDeadline[originId] = run.expiresAt;
                    emit BudgetRetry(
                        workflow,
                        run.epoch,
                        originId,
                        _weekStart(block.timestamp),
                        weeklyBudgets[workflow].revision,
                        run.expiresAt,
                        run.originTransaction,
                        run.originLogIndex,
                        run.originBlock,
                        run.observed,
                        run.actor
                    );
                } else {
                    delete retryDeadline[originId];
                }
            } else {
                delete retryDeadline[originId];
            }
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

    /// @notice Evaluates and executes the program in an isolated call with the Vault's storage.
    function settle(bytes32, P.Run calldata, bytes32) external returns (uint8, uint8) {
        if (msg.sender != address(this)) revert Unauthorized();
        address target = settlementModule;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {CallbackConfiguration, IReactiveSystem} from "../../shared/ReactiveTypes.sol";
import {WorkflowAgentStorageV2} from "./WorkflowAgentStorageV2.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";

interface IWorkflowSettlementV2 {
    function execute(address sender, bytes32 workflow, P.Run calldata run) external;
    function recordActivity(address sender, bytes32 workflow, uint64 epoch, uint64 activityTime)
        external;
}

/// @notice Delegatecall module executing `react` and `resumeWatching` for `WorkflowAgentV2`.
contract WorkflowAgentReactV2 is WorkflowAgentStorageV2 {
    address private immutable __self = address(this);

    modifier onlyDelegateCall() {
        if (address(this) == __self) revert Unauthorized();
        _;
    }

    constructor(IReactiveSystem system_, WorkflowProgramValidatorV2 validator_)
        WorkflowAgentStorageV2(system_, validator_)
    {}

    /// @notice Re-arms a paused workflow without waiting for its pinned wake.
    /// @dev Permissionless: the mirrored budget still has to admit a path, so this can only
    /// restore watching a run the Vault would settle. It is the recovery path if a targeted cron
    /// wake is ever missed while the Agent has no watching credit.
    function resumeWatching(bytes32 workflow) external onlyDelegateCall {
        Entry storage entry = entries[workflow];
        if (entry.trigger == 0) revert NotPaused();
        if (entry.expiry != 0 && block.timestamp > entry.expiry) {
            _retire(workflow, entry);
            return;
        }
        if (paused[workflow]) {
            if (!_budgetBlocks(workflow, 0)) {
                _resume(workflow, entry);
                return;
            }
            uint64 target = wakeAt[workflow];
            if (target != 0 && block.number > target && !_budgetBlocksFresh(workflow, 0)) {
                _pin(workflow, _resetAt(workflow));
                emit WatchingPaused(workflow, entry.epoch, wakeAt[workflow]);
                return;
            }
            revert BudgetBlocked();
        }
        uint256 count = pending[workflow].length;
        if (count == 0) revert NotPaused();
        for (uint256 index; index < count; ++index) {
            if (!_budgetBlocks(workflow, pending[workflow][index].observed)) {
                _retryPending(workflow);
                return;
            }
        }
        uint64 pendingTarget = wakeAt[workflow];
        if (pendingTarget != 0 && block.number > pendingTarget) {
            _syncPendingSchedule(workflow);
            if (wakeAt[workflow] != pendingTarget) return;
        }
        revert BudgetBlocked();
    }

    /// @notice Reacts to the exact configured emitters and dispatches one request per workflow and log.
    function react(IReactive.LogRecord calldata log) external onlyDelegateCall {
        if (msg.sender != address(system)) revert Unauthorized();
        if (log.log_index > type(uint64).max || log.block_number > type(uint64).max) return;
        if (log.topic_0 == BUDGET_SYNCED) {
            _syncBudget(log);
            return;
        }
        if (
            log.topic_0 == REFERENCE_SYNCED || log.topic_0 == GRACE_STARTED || log.topic_0 == CLOSED
                || log.topic_0 == PEAK_SYNCED
        ) {
            _syncVaultEvent(log);
            return;
        }
        // A Reactive cron tick also drives the waiting list, which is how a run parked by an
        // exhausted week resumes as soon as the week rolls over.
        if (
            log.chain_id == automationChain && log._contract == cronSource && log.topic_0 == CRON
                && log.topic_1 == log.block_number
        ) {
            _retryFromCron(log);
        }
        bool market;
        if (log.chain_id == primaryChain || log.chain_id == secondaryChain) {
            uint32 logChain = uint32(log.chain_id);
            (address logUsdc, address logPair, uint24 logPoolFee, bool logUsdc0) = _market(logChain);
            uint256 priceTopic = logPoolFee == 0 ? SYNC : SWAP_V3;
            market = log._contract == logPair && log.topic_0 == priceTopic
                && _recordPrice(logPoolFee, logUsdc0, log);
            ActivityCursor storage cursor = activityCursors[logChain];
            if (
                log._contract == logUsdc && log.topic_0 == TRANSFER && log.topic_1 == uint160(owner)
                    && log.topic_2 != log.topic_1
                    && (vaults[logChain] == address(0) || log.topic_2 != uint160(vaults[logChain]))
                    && log.data.length == 32
                    && (log.block_number > cursor.blockNumber
                        || (log.block_number == cursor.blockNumber
                            && log.log_index > cursor.logIndex))
                    && abi.decode(log.data, (uint256)) != 0
            ) {
                cursor.blockNumber = uint64(log.block_number);
                cursor.logIndex = uint64(log.log_index);
                if (block.timestamp > lastActivity) {
                    lastActivity = uint64(block.timestamp);
                    _cancelPendingPayouts();
                }
            }
        }
        // Retiring an entry removes it with a swap-and-pop, so the loop re-reads the same index
        // rather than stepping past the workflow that moved into it.
        uint256 index;
        while (index < active.length) {
            bytes32 workflow = active[index];
            Entry storage entry = entries[workflow];
            if (entry.expiry != 0 && block.timestamp > entry.expiry) {
                _retire(workflow, entry);
                continue;
            }
            _route(workflow, log, market);
            ++index;
        }
    }

    function _cancelPendingPayouts() private {
        for (uint256 index; index < active.length; ++index) {
            bytes32 workflow = active[index];
            uint64 graceUntil = payoutGraceUntil[workflow];
            if (graceUntil == 0 || block.timestamp > uint256(graceUntil) + GRACE_SKEW + LIFETIME) {
                continue;
            }
            Entry storage entry = entries[workflow];
            if (entry.expiry != 0 && block.timestamp > entry.expiry) continue;
            try system.requestCallbackV_1_0(
                CallbackConfiguration({
                    chainId: entry.chain,
                    recipient: vaults[entry.chain],
                    gasLimit: 100_000,
                    payload: abi.encodeCall(
                        IWorkflowSettlementV2.recordActivity,
                        (address(0), workflow, entry.epoch, lastActivity)
                    )
                })
            ) {}
                catch {
                // Scheduled runs still carry the recorded activity if the relay refuses a request.
            }
        }
    }

    /// @notice Retires a workflow whose signed expiry has passed and records the terminal state.
    function _retire(bytes32 workflow, Entry storage entry) private {
        uint64 epoch = entry.epoch;
        _stop(workflow, entry);
        emit Expired(workflow, epoch);
    }

    function _recordPrice(uint24 poolFee, bool usdcIsToken0, IReactive.LogRecord calldata log)
        private
        returns (bool)
    {
        PriceState storage state = prices[uint32(log.chain_id)][log._contract];
        if (
            log.block_number < state.blockNumber
                || (log.block_number == state.blockNumber && log.log_index <= state.logIndex)
                || log.block_number > type(uint64).max || log.log_index > type(uint64).max
        ) return false;
        uint128 observed = validator.decodePrice(poolFee, usdcIsToken0, log.data);
        if (observed == 0) return false;
        if (log.block_number > state.blockNumber) {
            state.previousPrice = state.price;
            state.previousTime = state.time;
            state.previousBlockNumber = state.blockNumber;
        }
        state.blockNumber = uint64(log.block_number);
        state.logIndex = uint64(log.log_index);
        state.time = uint64(block.timestamp);
        state.observation = keccak256(abi.encode(log.chain_id, log.tx_hash, log.log_index));
        state.price = observed;
        return true;
    }

    function _route(bytes32 workflow, IReactive.LogRecord calldata log, bool market) private {
        Entry storage entry = entries[workflow];
        if (paused[workflow]) {
            _wakeIfDue(workflow, entry, log);
            return;
        }
        P.Run memory run;
        if (entry.trigger == P.SCHEDULE) {
            if (
                log.chain_id != automationChain || log._contract != cronSource
                    || log.topic_0 != CRON || log.topic_1 != log.block_number
                    || log.block_number <= entry.lasnaAfter || block.timestamp < entry.nextDue
            ) return;
            if (entry.dip) {
                (, address dipPair,,) = _market(entry.originChain);
                PriceState storage state = prices[entry.originChain][dipPair];
                run.observed = state.price;
                run.previous = state.previousPrice;
                run.observationTime = state.time;
                run.observationId = state.observation;
            }
            if (entry.inactivity) run.activityTime = lastActivity;
        } else {
            if (log.chain_id != entry.originChain) return;
            if (entry.originChain == entry.chain && log.block_number <= entry.originAfter) return;
            if (entry.trigger == P.PRICE) {
                if (!market) return;
                PriceState storage state = prices[entry.originChain][log._contract];
                PriceHigh storage high = highs[workflow];
                uint128 sustained =
                    state.previousPrice < state.price ? state.previousPrice : state.price;
                if (
                    sustained > high.value && state.previousTime >= entry.nextDue
                        && (entry.originChain != entry.chain
                            || state.previousBlockNumber > entry.originAfter)
                ) {
                    high.value = sustained;
                    high.blockNumber = state.previousBlockNumber;
                    high.observedAt = state.previousTime;
                }
                WorkflowMeta storage info = meta[workflow];
                (uint128 previousLow, uint128 previousHigh) = _crossingRange(workflow, info, state);
                bool cooling = block.timestamp < info.cooldownUntil;
                if (cooling && (info.flags & P.FLAG_CROSSING) == 0) return;
                uint256 refPrice = (info.flags & FLAG_REF_PENDING) != 0
                    && block.timestamp < uint256(info.cooldownUntil) + LIFETIME
                    ? type(uint256).max
                    : info.referencePrice;
                if (!validator.canTriggerPriceRange(
                        programs[entry.hash],
                        state.price,
                        previousLow,
                        previousHigh,
                        high.value,
                        refPrice,
                        cooling
                    )) return;
                run.observed = state.price;
                run.previous = state.previousPrice;
                run.high = high.value;
                run.highBlock = high.blockNumber;
                run.observationTime = state.time;
                run.observationId = P.priceEvidence(previousHigh, high.observedAt, cooling);
                // A price log has no payer. Preserve the immediate previous price for old Vaults.
                run.actor = address(uint160(previousLow));
            } else {
                if (log.data.length != 32) return;
                uint256 amount = abi.decode(log.data, (uint256));
                if (amount == 0) return;
                address sourceToken = entry.source;
                if (entry.trigger == P.PAYMENT) {
                    (sourceToken,,,) = _market(entry.originChain);
                }
                address watched = entry.trigger == P.PAYMENT ? address(0) : entry.subject;
                if (
                    log._contract != sourceToken || log.topic_0 != TRANSFER
                        || log.topic_1 == log.topic_2
                ) return;
                if (watched == address(0)) {
                    if (log.topic_2 != uint160(vaults[entry.chain])) return;
                    if (entry.trigger == P.PAYMENT && log.topic_1 == uint160(owner)) return;
                } else if (log.topic_1 != uint160(watched) && log.topic_2 != uint160(watched)) {
                    return;
                }
                run.actor = address(
                    uint160(
                        watched != address(0) && log.topic_1 == uint160(watched)
                            ? log.topic_2
                            : log.topic_1
                    )
                );
                if (!validator.canTriggerTransfer(programs[entry.hash], amount, run.actor)) return;
                run.observed = amount;
                run.observationTime = uint64(block.timestamp);
            }
        }
        run.epoch = entry.epoch;
        run.programHash = entry.hash;
        run.originChain = uint32(log.chain_id);
        run.originTransaction = bytes32(log.tx_hash);
        run.originLogIndex = uint64(log.log_index);
        run.originBlock = uint64(log.block_number);
        run.expiresAt = uint64(block.timestamp) + LIFETIME;
        bytes32 runId = _runId(workflow, run.originChain, run.originTransaction, run.originLogIndex);
        if (seen[runId]) return;
        if (_budgetBlocks(workflow, run.observed)) {
            if (entry.trigger == P.PAYMENT || entry.trigger == P.TRANSFER) _park(workflow, run);
            else _pause(workflow, entry);
            return;
        }
        seen[runId] = true;
        _dispatch(workflow, entry, run, runId);
    }

    function _crossingRange(bytes32 workflow, WorkflowMeta storage info, PriceState storage state)
        private
        returns (uint128 low, uint128 high)
    {
        low = state.previousPrice;
        high = low;
        if ((info.flags & P.FLAG_CROSSING) == 0) return (low, high);
        CrossingRange storage range = crossings[workflow];
        if (range.blockNumber == 0) return (low, high);
        // Add completed blocks only. Intra-block pool wicks must not become crossing evidence.
        if (state.previousBlockNumber >= range.blockNumber && low != 0) {
            if (range.low == 0 || low < range.low) range.low = low;
            if (high > range.high) range.high = high;
        }
        return (range.low, range.high);
    }

    function _dispatch(bytes32 workflow, Entry storage entry, P.Run memory run, bytes32 runId)
        private
    {
        if (entry.trigger == P.SCHEDULE) {
            uint256 due = entry.nextDue;
            entry.nextDue =
                uint64(due + (1 + (block.timestamp - due) / entry.interval) * entry.interval);
            entry.lasnaAfter = run.originBlock;
        } else if (entry.trigger == P.PRICE) {
            uint256 nextCooldown = block.timestamp + PRICE_COOLDOWN;
            WorkflowMeta storage info = meta[workflow];
            info.cooldownUntil =
                nextCooldown > type(uint40).max ? type(uint40).max : uint40(nextCooldown);
            if ((info.flags & P.FLAG_USES_REFERENCE) != 0) info.flags |= FLAG_REF_PENDING;
            if ((info.flags & P.FLAG_CROSSING) != 0) {
                crossings[workflow] = CrossingRange(0, 0, run.originBlock);
            }
        }
        emit Dispatched(
            workflow,
            runId,
            run.programHash,
            run.originChain,
            run.originTransaction,
            run.originLogIndex,
            entry.chain,
            run.epoch,
            run.expiresAt
        );
        system.requestCallbackV_1_0(
            CallbackConfiguration({
                chainId: entry.chain,
                recipient: vaults[entry.chain],
                gasLimit: CALLBACK_GAS,
                payload: abi.encodeCall(IWorkflowSettlementV2.execute, (address(0), workflow, run))
            })
        );
    }

    function _park(bytes32 workflow, P.Run memory run) private {
        Pending[] storage queue = pending[workflow];
        uint256 count = queue.length;
        for (uint256 index; index < count; ++index) {
            if (
                queue[index].originTransaction == run.originTransaction
                    && queue[index].originLogIndex == run.originLogIndex
            ) return;
        }
        bytes32 runId = _runId(workflow, run.originChain, run.originTransaction, run.originLogIndex);
        if (count >= MAX_PENDING) {
            emit QueueDropped(workflow, runId);
            return;
        }
        queue.push(
            Pending({
                programHash: run.programHash,
                epoch: run.epoch,
                originTransaction: run.originTransaction,
                originLogIndex: run.originLogIndex,
                originBlock: run.originBlock,
                observed: run.observed,
                actor: run.actor
            })
        );
        _syncPendingSchedule(workflow);
        emit Queued(workflow, runId, run.observed, run.actor);
    }

    function _retryFromCron(IReactive.LogRecord calldata log) private {
        uint256 index;
        while (index < active.length) {
            bytes32 workflow = active[index];
            if (pending[workflow].length != 0) {
                uint64 target = wakeAt[workflow];
                if (
                    retryWaiting[workflow]
                        || (budgets[workflow].known && block.timestamp >= _resetAt(workflow))
                ) {
                    _retryPending(workflow);
                } else if (target != 0 && (log.topic_1 == target || log.block_number >= target)) {
                    _pin(workflow, _resetAt(workflow));
                }
            }
            if (index < active.length && active[index] == workflow) ++index;
        }
    }

    function _retryPending(bytes32 workflow) private {
        Pending[] storage queue = pending[workflow];
        if (queue.length == 0) {
            _syncPendingSchedule(workflow);
            return;
        }
        Entry storage entry = entries[workflow];
        if (entry.trigger == 0) {
            _clearPending(workflow);
            _unpin(workflow);
            return;
        }
        if (entry.expiry != 0 && block.timestamp > entry.expiry) {
            _retire(workflow, entry);
            return;
        }
        uint256 index;
        while (index < queue.length) {
            Pending memory item = queue[index];
            bytes32 runId =
                _runId(workflow, entry.originChain, item.originTransaction, item.originLogIndex);
            if (seen[runId]) {
                _removePending(workflow, index);
                continue;
            }
            if (_budgetBlocks(workflow, item.observed)) {
                ++index;
                continue;
            }
            _removePending(workflow, index);
            seen[runId] = true;
            P.Run memory run;
            run.epoch = item.epoch;
            run.programHash = item.programHash;
            run.originChain = entry.originChain;
            run.originTransaction = item.originTransaction;
            run.originLogIndex = item.originLogIndex;
            run.originBlock = item.originBlock;
            run.expiresAt = uint64(block.timestamp) + LIFETIME;
            run.observed = item.observed;
            run.actor = item.actor;
            _dispatch(workflow, entry, run, runId);
            _syncPendingSchedule(workflow);
            return;
        }
        _syncPendingSchedule(workflow);
    }

    function _removePending(bytes32 workflow, uint256 index) private {
        Pending[] storage queue = pending[workflow];
        uint256 last = queue.length - 1;
        for (uint256 i = index; i < last;) {
            queue[i] = queue[i + 1];
            unchecked {
                ++i;
            }
        }
        queue.pop();
    }

    function _syncPendingSchedule(bytes32 workflow) private {
        Pending[] storage queue = pending[workflow];
        uint256 count = queue.length;
        Entry storage entry = entries[workflow];
        if (count == 0 || entry.trigger == 0) {
            _setRetryWaiting(workflow, false);
            if (!paused[workflow]) _unpin(workflow);
            return;
        }
        bool hasUnblocked;
        bool hasRecoverable;
        for (uint256 index; index < count; ++index) {
            uint256 observed = queue[index].observed;
            if (!_budgetBlocks(workflow, observed)) {
                hasUnblocked = true;
                break;
            }
            if (!_budgetBlocksFresh(workflow, observed)) {
                hasRecoverable = true;
            }
        }
        if (hasUnblocked) {
            if (!paused[workflow]) _unpin(workflow);
            _setRetryWaiting(workflow, true);
            return;
        }
        _setRetryWaiting(workflow, false);
        if (!paused[workflow]) {
            uint64 reset = _resetAt(workflow);
            if (hasRecoverable && block.timestamp < reset) {
                uint64 current = wakeAt[workflow];
                if (current == 0 || block.number >= current) _pin(workflow, reset);
            } else {
                _unpin(workflow);
            }
        }
    }

    function _pause(bytes32 workflow, Entry storage entry) private {
        if (paused[workflow]) return;
        paused[workflow] = true;
        _triggerFilters(entry, !paused[workflow]);
        _enterPause(workflow, entry);
    }

    function _resume(bytes32 workflow, Entry storage entry) private {
        if (!paused[workflow]) return;
        paused[workflow] = false;
        meta[workflow].cooldownUntil = 0;
        _unpin(workflow);
        _triggerFilters(entry, !paused[workflow]);
        emit WatchingResumed(workflow, entry.epoch);
    }

    function _wakeIfDue(bytes32 workflow, Entry storage entry, IReactive.LogRecord calldata log)
        private
    {
        uint64 target = wakeAt[workflow];
        if (
            target == 0 || log.chain_id != automationChain || log._contract != cronSource
                || log.topic_0 != CRON || log.topic_1 != target
        ) return;
        uint64 reset = _resetAt(workflow);
        if (block.timestamp < reset) {
            _pin(workflow, reset);
            return;
        }
        _resume(workflow, entry);
    }

    function _runId(
        bytes32 workflow,
        uint32 originChain,
        bytes32 originTransaction,
        uint64 originLogIndex
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(address(this), workflow, originChain, originTransaction, originLogIndex)
        );
    }

    function _syncBudget(IReactive.LogRecord calldata log) private {
        if (log.data.length != 192) return;
        bytes32 workflow = bytes32(log.topic_1);
        Entry storage entry = entries[workflow];
        if (entry.epoch == 0 || log.chain_id != entry.chain || log._contract != vaults[entry.chain])
        {
            return;
        }
        (
            uint96 usdcLimit,
            uint96 wethLimit,
            uint128 usdcSpent,
            uint128 wethSpent,
            uint64 weekStart,
            uint32 revision
        ) = abi.decode(log.data, (uint96, uint96, uint128, uint128, uint64, uint32));
        Budget storage budget = budgets[workflow];
        address vault = log._contract;
        if (revision < budgetRevisions[workflow][vault]) return;
        if (
            budget.known
                && (revision < budget.revision
                    || weekStart < budget.weekStart
                    || (weekStart == budget.weekStart
                        && (usdcSpent < budget.usdcSpent || wethSpent < budget.wethSpent)))
        ) return;
        uint64 prevWeek = budget.weekStart;
        budgetRevisions[workflow][vault] = revision;
        budgets[workflow] =
            Budget(usdcLimit, wethLimit, usdcSpent, wethSpent, weekStart, revision, true);
        if (entry.trigger == 0) return;
        if (entry.expiry != 0 && block.timestamp > entry.expiry) {
            _retire(workflow, entry);
            return;
        }
        if (entry.trigger == P.SCHEDULE || entry.trigger == P.PRICE) {
            bool blocked = _budgetBlocks(workflow, 0);
            if (paused[workflow]) {
                if (!blocked) {
                    _resume(workflow, entry);
                } else if (_budgetBlocksFresh(workflow, 0)) {
                    _unpin(workflow);
                } else {
                    _pin(workflow, _resetAt(workflow));
                }
            } else if (blocked) {
                _pause(workflow, entry);
            }
        }
        if (!paused[workflow] && prevWeek != weekStart) _unpin(workflow);
        _retryPending(workflow);
    }

    function _syncVaultEvent(IReactive.LogRecord calldata log) private {
        bytes32 workflow = bytes32(log.topic_1);
        Entry storage entry = entries[workflow];
        if (
            entry.trigger == 0 || log.chain_id != entry.chain
                || log._contract != vaults[entry.chain] || log.topic_2 != entry.epoch
        ) return;
        if (log.topic_0 == CLOSED) {
            if (entry.once) {
                _stop(workflow, entry);
                emit Disabled(workflow, entry.epoch);
            }
            return;
        }
        if (log.data.length != 32) return;
        if (log.topic_0 == GRACE_STARTED) {
            if (entry.trigger != P.SCHEDULE || !entry.inactivity) return;
            uint64 eligibleAt = abi.decode(log.data, (uint64));
            if (eligibleAt == 0) return;
            if (eligibleAt > payoutGraceUntil[workflow]) payoutGraceUntil[workflow] = eligibleAt;
            uint64 target = eligibleAt + GRACE_SKEW;
            if (target < entry.nextDue) entry.nextDue = target;
            return;
        }
        if (log.topic_0 == PEAK_SYNCED) {
            if (entry.trigger != P.PRICE) return;
            uint128 syncedPeak = abi.decode(log.data, (uint128));
            highs[workflow].value = syncedPeak;
            highs[workflow].blockNumber = syncedPeak == 0 ? 0 : uint64(log.block_number);
            highs[workflow].observedAt = 0;
            return;
        }
        if (
            entry.trigger != P.PRICE || log.block_number > type(uint48).max
                || log.log_index > type(uint32).max
        ) return;
        uint128 nextReference = abi.decode(log.data, (uint128));
        if (nextReference == 0) return;
        WorkflowMeta storage info = meta[workflow];
        if (
            log.block_number < info.referenceBlock
                || (log.block_number == info.referenceBlock
                    && log.log_index <= info.referenceLogIndex)
        ) return;
        info.referencePrice = nextReference;
        info.referenceBlock = uint48(log.block_number);
        info.referenceLogIndex = uint32(log.log_index);
        info.flags &= ~FLAG_REF_PENDING;
    }
}

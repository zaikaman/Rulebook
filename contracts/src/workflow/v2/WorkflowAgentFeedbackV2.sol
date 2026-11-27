// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {IReactiveSystem} from "../../shared/ReactiveTypes.sol";
import {WorkflowAgentStorageV2} from "./WorkflowAgentStorageV2.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";

/// @notice Handles authenticated settlement feedback in the Agent's shared storage.
contract WorkflowAgentFeedbackV2 is WorkflowAgentStorageV2 {
    address private immutable self = address(this);

    constructor(IReactiveSystem system_, WorkflowProgramValidatorV2 validator_)
        WorkflowAgentStorageV2(system_, validator_)
    {}

    function handleSettlement(IReactive.LogRecord calldata log) external {
        _authenticate();
        if (log.topic_0 == OUTCOME) _syncOutcome(log);
        else _syncVaultEvent(log);
    }

    /// @notice Builds price evidence against the latest authenticated pool observation.
    function priceRun(bytes32 workflow, address pair) external returns (P.Run memory run) {
        _authenticate();
        Entry storage entry = entries[workflow];
        PriceState storage state = prices[entry.originChain][pair];
        PriceHigh storage high = highs[workflow];
        uint128 sustained = state.previousPrice < state.price ? state.previousPrice : state.price;
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
        bool hasCrossing = (info.flags & P.FLAG_CROSSING) != 0;
        if (cooling && !hasCrossing) return run;
        uint256 refPrice = (info.flags & FLAG_REF_PENDING) != 0
            && block.timestamp < uint256(info.cooldownUntil) + LIFETIME
            ? type(uint256).max
            : info.referencePrice;
        bytes memory encoded = programs[entry.hash];
        bool crossing;
        if (hasCrossing && crossingInFlight[workflow].length < MAX_CROSSING_IN_FLIGHT) {
            crossing = validator.canTriggerPriceRange(
                encoded, state.price, previousLow, previousHigh, high.value, refPrice, true
            );
            CrossingRecovery storage recovery = crossingRecoveries[workflow];
            if (!crossing && recovery.sequence != 0 && block.timestamp >= recovery.retryAt) {
                uint128 recoveredLow = previousLow;
                uint128 recoveredHigh = previousHigh;
                if (recovery.low != 0 && (recoveredLow == 0 || recovery.low < recoveredLow)) {
                    recoveredLow = recovery.low;
                }
                if (recovery.high > recoveredHigh) recoveredHigh = recovery.high;
                crossing = validator.canTriggerPriceRange(
                    encoded, state.price, recoveredLow, recoveredHigh, high.value, refPrice, true
                );
                if (crossing) {
                    previousLow = recoveredLow;
                    previousHigh = recoveredHigh;
                    // A fresh pool observation retains the failed crossing's settlement identity.
                    run.activityTime = recovery.sequence;
                }
            }
        }
        if (
            !crossing
                && (cooling
                    || !validator.canTriggerPriceRange(
                        encoded, state.price, previousLow, previousHigh, high.value, refPrice, false
                    ))
        ) return run;
        run.observed = state.price;
        run.previous = state.previousPrice;
        run.high = high.value;
        run.highBlock = high.blockNumber;
        run.observationTime = state.time;
        run.observationId = P.priceEvidence(previousHigh, high.observedAt, crossing);
        // A price log has no payer. Preserve the immediate previous price for old Vaults.
        run.actor = address(uint160(previousLow));
    }

    function _crossingRange(bytes32 workflow, WorkflowMeta storage info, PriceState storage state)
        private
        returns (uint128 low, uint128 high)
    {
        low = state.previousPrice;
        high = low;
        if ((info.flags & P.FLAG_CROSSING) == 0) return (low, high);
        bytes32[] storage inFlight = crossingInFlight[workflow];
        uint256 index;
        while (index < inFlight.length) {
            bytes32 runId = inFlight[index];
            if (block.timestamp > crossingAttempts[runId].expiresAt) {
                _completeCrossing(workflow, runId, false);
            } else {
                ++index;
            }
        }
        CrossingRange storage range = crossings[workflow];
        if (range.blockNumber == 0) return (low, high);
        // Add completed blocks only. Intra-block pool wicks must not become crossing evidence.
        if (state.previousBlockNumber >= range.blockNumber && low != 0) {
            if (range.low == 0 || low < range.low) range.low = low;
            if (high > range.high) range.high = high;
        }
        return (range.low, range.high);
    }

    function _authenticate() private view {
        if (address(this) == self || msg.sender != address(system)) revert Unauthorized();
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
        if (log.topic_0 == PEAK_CORRECTED) {
            if (entry.trigger == P.PRICE) _syncPeak(workflow, log.data);
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

    function _syncPeak(bytes32 workflow, bytes calldata data) private {
        if (data.length != 128) return;
        (uint128 peak, uint128 rejected, uint64 originBlock, uint64 observedAt) =
            abi.decode(data, (uint128, uint128, uint64, uint64));
        PriceHigh storage current = highs[workflow];
        if (
            current.value != rejected || current.blockNumber != originBlock
                || current.observedAt != observedAt
        ) return;
        current.value = peak;
        current.blockNumber = peak == 0 ? 0 : originBlock;
        current.observedAt = 0;
    }

    function _syncOutcome(IReactive.LogRecord calldata log) private {
        if (log.data.length != 128) return;
        bytes32 workflow = bytes32(log.topic_1);
        Entry storage entry = entries[workflow];
        (uint64 epoch, uint8 status,, bytes4 reason) =
            abi.decode(log.data, (uint64, uint8, uint8, bytes4));
        if (
            entry.trigger == 0 || entry.epoch != epoch || log.chain_id != entry.chain
                || log._contract != vaults[entry.chain]
        ) return;
        if ((meta[workflow].flags & P.FLAG_CROSSING) != 0) {
            _completeCrossing(
                workflow,
                bytes32(log.topic_2),
                status == 1 || reason == CROSSING_SETTLED || reason == INVALID_AUTHORIZATION
            );
        }
        if (entry.trigger != P.SCHEDULE && entry.trigger != P.PRICE) return;
        uint128 position = _position(uint64(log.block_number), uint64(log.log_index));
        if (position <= fundingOutcomePosition[workflow]) return;
        fundingOutcomePosition[workflow] = position;
        if (
            reason != INSUFFICIENT_VAULT && reason != INSUFFICIENT_ALLOWANCE
                && reason != INSUFFICIENT_OWNER
        ) return;
        if (fundingPaused[workflow]) return;
        fundingPaused[workflow] = true;
        if (!paused[workflow]) {
            paused[workflow] = true;
            _triggerFilters(workflow, entry, false);
        }
        _unpin(workflow);
        emit FundingPaused(workflow, epoch, reason);
    }
}

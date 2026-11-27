// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {WorkflowVaultStorageV2} from "./WorkflowVaultStorageV2.sol";

/// @notice Executes Vault settlement in the calling Vault's storage and balance context.
contract WorkflowVaultSettlementV2 is WorkflowVaultStorageV2 {
    using SafeERC20 for IERC20;

    constructor(
        address proxy,
        uint32 chain_,
        Networks memory cfg,
        WorkflowProgramValidatorV2 validator_
    ) WorkflowVaultStorageV2(proxy, chain_, cfg, validator_) {}

    /// @notice Evaluates and executes the current program. Only the isolated settlement call can enter.
    function settle(bytes32 workflow, P.Run calldata run, bytes32 runId)
        external
        returns (uint8, uint8)
    {
        if (msg.sender != address(this)) revert Unauthorized();
        P.Program memory program = abi.decode(programs[run.programHash], (P.Program));
        if (P.retryNonce(run) != 0 && program.trigger != P.PAYMENT && program.trigger != P.TRANSFER)
        {
            revert InvalidAuthorization();
        }
        Memory storage memory_ = workflowMemory[workflow];
        if (program.expires != 0 && block.timestamp > program.expires) return (EXPIRED, NO_PATH);
        if (memory_.closed) return (SKIPPED, NO_PATH);
        if (program.trigger == P.PAYMENT && run.actor == owner) revert NoLongerEligible();

        Context memory ctx;
        bytes32 crossingKey;
        if (run.observationId != bytes32(0)) {
            ctx.dipAvailable = !consumedDips[workflow][run.observationId];
        }
        if (program.trigger == P.PRICE) {
            if (run.activityTime != 0) {
                crossingKey = keccak256(abi.encode(workflow, run.epoch));
                if (run.activityTime <= confirmedCrossingSequence[crossingKey]) {
                    revert CrossingAlreadySettled();
                }
            }
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
                            || run.highBlock > _authorizations[workflow].originAfter)
                ) {
                    memory_.peak = run.high;
                } else {
                    emit PeakCorrected(
                        workflow,
                        run.epoch,
                        memory_.peak,
                        run.high,
                        run.highBlock,
                        uint64(uint256(run.observationId))
                    );
                }
            }
        }

        if (program.trigger == P.SCHEDULE && run.activityTime != 0) {
            _recordActivity(workflow, run.activityTime);
        }

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
            if (run.activityTime != 0) confirmedCrossingSequence[crossingKey] = run.activityTime;
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
            _authorizations[workflow].active = false;
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

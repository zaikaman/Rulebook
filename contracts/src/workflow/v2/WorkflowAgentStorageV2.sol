// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {AbstractPayer} from "@reactive/abstract-base/AbstractPayer.sol";
import {ChainConfig} from "../../chain/ChainConfig.sol";
import {IReactiveSystem} from "../../shared/ReactiveTypes.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";

/// @notice Shared storage layout, immutables, and subscription/budget helpers for WorkflowAgentV2.
abstract contract WorkflowAgentStorageV2 is AbstractPayer {
    uint256 internal constant ANY =
        0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 internal constant CRON = uint256(keccak256("Cron100(uint256)"));
    uint256 internal constant SYNC = uint256(keccak256("Sync(uint112,uint112)"));
    uint256 internal constant SWAP_V3 =
        uint256(keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)"));
    uint256 internal constant TRANSFER = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 internal constant CLOSED = uint256(keccak256("Closed(bytes32,uint64)"));
    uint256 internal constant BUDGET_SYNCED =
        uint256(keccak256("BudgetSynced(bytes32,uint96,uint96,uint128,uint128,uint64,uint32)"));
    uint256 internal constant REFERENCE_SYNCED =
        uint256(keccak256("ReferenceSynced(bytes32,uint64,uint128)"));
    uint256 internal constant GRACE_STARTED =
        uint256(keccak256("GraceStarted(bytes32,uint64,uint64)"));
    uint256 internal constant PEAK_SYNCED =
        uint256(keccak256("PeakSynced(bytes32,uint64,uint128)"));
    uint64 internal constant LIFETIME = 10 minutes;
    uint64 internal constant GRACE_SKEW = 2 minutes;
    uint64 public constant PRICE_COOLDOWN = 60 seconds;
    uint64 internal constant CALLBACK_GAS = 1_200_000;
    uint8 internal constant FLAG_REF_PENDING = 64;
    uint256 internal constant MAX_ACTIVE = 4;
    // Bounds the per-workflow waiting list so a burst of blocked triggers can never make a cron
    // retry or a later budget sync unbounded. Oldest runs are kept; the newest is reported dropped.
    uint256 internal constant MAX_PENDING = 8;
    uint64 internal constant WEEK = 7 days;
    // Reactive and destination chains can differ by seconds. The mirror only rolls a week forward
    // after the boundary has certainly passed on both chains, so the Agent never suppresses a run
    // the Vault would settle against the week the spend was recorded in.
    uint64 internal constant WEEK_SKEW = 10 minutes;
    // Reactive blocks arrive near ~0.785s (Mainnet) to ~1.09s (Lasna). Conservative per-chain
    // block-time overestimates wake the agent shortly before reset while minimizing mainnet re-pins.
    uint256 internal constant LASNA_BLOCK_MS = 2_000;
    uint256 internal constant MAINNET_BLOCK_MS = 820;

    struct Entry {
        bytes32 hash;
        uint64 epoch;
        uint64 nextDue;
        uint64 lasnaAfter;
        uint8 trigger;
        uint32 chain;
        uint32 interval;
        uint64 expiry;
        address source;
        address subject;
        bool dip;
        bool inactivity;
        bool once;
        uint64 originAfter;
        uint32 originChain;
    }

    struct PriceState {
        uint128 price;
        uint128 previousPrice;
        uint64 time;
        uint64 previousTime;
        bytes32 observation;
        uint64 blockNumber;
        uint64 logIndex;
        uint64 previousBlockNumber;
    }

    struct ActivityCursor {
        uint64 blockNumber;
        uint64 logIndex;
    }

    struct PriceHigh {
        uint128 value;
        uint64 blockNumber;
    }

    struct Filter {
        uint32 chain;
        address source;
        uint256 signature;
        uint256 topic1;
        uint256 topic2;
    }

    /// @notice Per-workflow runtime flags, mirrored reference price, and PRICE cooldown state.
    struct WorkflowMeta {
        uint128 referencePrice;
        uint48 referenceBlock;
        uint32 referenceLogIndex;
        uint40 cooldownUntil;
        uint8 flags;
    }

    /// @notice The last weekly budget the Vault published for a workflow.
    struct Budget {
        uint96 usdcLimit;
        uint96 wethLimit;
        uint128 usdcSpent;
        uint128 wethSpent;
        uint64 weekStart;
        uint32 revision;
        bool known;
    }

    /// @notice Initial weekly budget snapshot seeded atomically at activation.
    struct BudgetSeed {
        uint96 usdcLimit;
        uint96 wethLimit;
        uint128 usdcSpent;
        uint128 wethSpent;
        uint64 weekStart;
        uint32 revision;
    }

    /// @notice A budget-blocked payment or transfer run kept for a later dispatch.
    /// @dev Only the fields settlement reads for these triggers are stored; the callback deadline
    /// is rebuilt from `LIFETIME` when the run is retried.
    struct Pending {
        bytes32 programHash;
        uint64 epoch;
        bytes32 originTransaction;
        uint64 originLogIndex;
        uint64 originBlock;
        uint256 observed;
        address actor;
    }

    error Unauthorized();
    error InvalidWorkflow();
    error NotPaused();
    error BudgetBlocked();

    event Queued(bytes32 indexed workflow, bytes32 indexed runId, uint256 observed, address actor);
    event QueueDropped(bytes32 indexed workflow, bytes32 indexed runId);
    event Enabled(
        bytes32 indexed workflow,
        bytes32 indexed programHash,
        uint32 chain,
        uint64 epoch,
        string title
    );
    event Disabled(bytes32 indexed workflow, uint64 epoch);
    event Expired(bytes32 indexed workflow, uint64 epoch);
    event WatchingPaused(bytes32 indexed workflow, uint64 epoch, uint64 wakeBlock);
    event WatchingResumed(bytes32 indexed workflow, uint64 epoch);
    event Dispatched(
        bytes32 indexed workflow,
        bytes32 indexed runId,
        bytes32 indexed programHash,
        uint32 originChain,
        bytes32 originTransaction,
        uint64 originLogIndex,
        uint32 chain,
        uint64 epoch,
        uint64 expiresAt
    );

    IReactiveSystem public immutable system;
    WorkflowProgramValidatorV2 public immutable validator;
    uint32 public immutable automationChain;
    address internal immutable cronSource;
    uint32 internal immutable primaryChain;
    uint32 internal immutable secondaryChain;
    address internal immutable primaryUsdc;
    address internal immutable secondaryUsdc;
    address internal immutable primaryPair;
    address internal immutable secondaryPair;
    uint24 internal immutable primaryPoolFee;
    uint24 internal immutable secondaryPoolFee;
    bool internal immutable primaryUsdc0;
    bool internal immutable secondaryUsdc0;
    uint256 internal immutable blockMs;

    address public owner;
    mapping(uint32 => address) public vaults;
    mapping(bytes32 => Entry) public entries;
    mapping(bytes32 => PriceHigh) internal highs;
    mapping(bytes32 => bytes) public programs;
    mapping(bytes32 => uint256[]) internal paths;
    mapping(bytes32 => WorkflowMeta) public meta;
    mapping(bytes32 => Budget) public budgets;
    mapping(bytes32 => string) public titles;
    mapping(bytes32 => bool) internal seen;
    mapping(bytes32 => Pending[]) internal pending;
    mapping(bytes32 => bool) internal paused;
    mapping(bytes32 => uint64) internal wakeAt;
    mapping(bytes32 => uint256) internal subscriptions;
    bytes32[] internal active;
    bytes32[] internal known;
    mapping(bytes32 => bool) internal retryWaiting;
    uint256 internal retryWaitingCount;
    mapping(uint32 => mapping(address => PriceState)) internal prices;
    uint64 internal lastActivity;
    mapping(uint32 => ActivityCursor) internal activityCursors;
    address public factory;
    uint256[50] private __gap;

    constructor(IReactiveSystem system_, WorkflowProgramValidatorV2 validator_) {
        if (!ChainConfig.isAutomationChain(block.chainid)) revert InvalidWorkflow();
        system = system_;
        validator = validator_;
        automationChain = uint32(block.chainid);
        bool isMainnet = block.chainid == ChainConfig.REACTIVE_MAINNET;
        cronSource = ChainConfig.get(block.chainid).cronSource;
        ChainConfig.Config memory pCfg =
            ChainConfig.get(isMainnet ? P.UNICHAIN_MAINNET : P.UNICHAIN_SEPOLIA);
        ChainConfig.Config memory sCfg =
            ChainConfig.get(isMainnet ? P.BASE_MAINNET : P.BASE_SEPOLIA);
        primaryChain = uint32(pCfg.chainId);
        secondaryChain = uint32(sCfg.chainId);
        primaryUsdc = pCfg.usdc;
        secondaryUsdc = sCfg.usdc;
        primaryPair = pCfg.pair;
        secondaryPair = sCfg.pair;
        primaryPoolFee = pCfg.poolFee;
        secondaryPoolFee = sCfg.poolFee;
        primaryUsdc0 = pCfg.usdc < pCfg.weth;
        secondaryUsdc0 = sCfg.usdc < pCfg.weth;
        blockMs = isMainnet ? MAINNET_BLOCK_MS : LASNA_BLOCK_MS;
    }

    function _market(uint32 chainId)
        internal
        view
        returns (address usdc, address pair, uint24 poolFee, bool usdc0)
    {
        return chainId == primaryChain
            ? (primaryUsdc, primaryPair, primaryPoolFee, primaryUsdc0)
            : (secondaryUsdc, secondaryPair, secondaryPoolFee, secondaryUsdc0);
    }

    function _stop(bytes32 workflow, Entry storage entry) internal {
        if (paused[workflow]) {
            paused[workflow] = false;
            _settlementFilters(workflow, entry, false);
        } else {
            _filters(workflow, entry, false);
        }
        _clearPending(workflow);
        _unpin(workflow);
        delete meta[workflow];
        entry.trigger = 0;
        for (uint256 index; index < active.length; ++index) {
            if (active[index] != workflow) continue;
            active[index] = active[active.length - 1];
            active.pop();
            break;
        }
    }

    function _filters(bytes32 workflow, Entry storage entry, bool enabled) internal {
        _settlementFilters(workflow, entry, enabled);
        _triggerFilters(entry, enabled);
    }

    /// @notice Filters that stay installed while a workflow is paused for its weekly budget.
    function _settlementFilters(bytes32 workflow, Entry storage entry, bool enabled) internal {
        _applyFilters(
            validator.settlementFilters(
                entry.chain,
                vaults[entry.chain],
                owner,
                meta[workflow].flags,
                entry.epoch,
                workflow,
                primaryChain,
                primaryUsdc,
                secondaryChain,
                secondaryUsdc
            ),
            enabled
        );
    }

    /// @notice Filters that only exist to trigger a run, and are removed while watching is paused.
    function _triggerFilters(Entry storage entry, bool enabled) internal {
        (address originUsdc, address originPair, uint24 originPoolFee,) = _market(entry.originChain);
        _applyFilters(
            validator.triggerFilters(
                WorkflowProgramValidatorV2.TriggerFilterParams({
                    trigger: entry.trigger,
                    chain: entry.chain,
                    originChain: entry.originChain,
                    automationChain: automationChain,
                    cronSource: cronSource,
                    vault: vaults[entry.chain],
                    originUsdc: originUsdc,
                    originPair: originPair,
                    originPoolFee: originPoolFee,
                    source: entry.source,
                    subject: entry.subject,
                    dip: entry.dip
                })
            ),
            enabled
        );
    }

    function _applyFilters(WorkflowProgramValidatorV2.Filter[] memory list, bool enabled) internal {
        for (uint256 index; index < list.length; ++index) {
            WorkflowProgramValidatorV2.Filter memory item = list[index];
            _filter(
                Filter(item.chain, item.source, item.signature, item.topic1, item.topic2), enabled
            );
        }
    }

    function _filter(Filter memory filter, bool enabled) internal {
        bytes32 key = keccak256(abi.encode(filter));
        if (enabled) {
            if (subscriptions[key]++ != 0) return;
            system.subscribe(
                filter.chain, filter.source, filter.signature, filter.topic1, filter.topic2, ANY
            );
        } else {
            if (--subscriptions[key] != 0) return;
            system.unsubscribe(
                filter.chain, filter.source, filter.signature, filter.topic1, filter.topic2, ANY
            );
        }
    }

    /// @notice Drops every parked run for a workflow whose epoch or trigger just changed.
    function _clearPending(bytes32 workflow) internal {
        if (pending[workflow].length == 0) return;
        delete pending[workflow];
        _setRetryWaiting(workflow, false);
    }

    function _setRetryWaiting(bytes32 workflow, bool waiting) internal {
        bool current = retryWaiting[workflow];
        if (waiting == current) return;
        retryWaiting[workflow] = waiting;
        if (waiting) {
            if (retryWaitingCount++ == 0) _cronFilter(true);
        } else {
            if (--retryWaitingCount == 0) _cronFilter(false);
        }
    }

    /// @notice Holds the Reactive cron subscription that drives retries while runnable items wait.
    function _cronFilter(bool enabled) internal {
        _filterCron(ANY, enabled);
    }

    function _enterPause(bytes32 workflow, Entry storage entry) internal {
        paused[workflow] = true;
        uint64 reset = _resetAt(workflow);
        bool recoverable = !_budgetBlocksFresh(workflow, 0);
        if (recoverable) _pin(workflow, reset);
        emit WatchingPaused(workflow, entry.epoch, recoverable ? wakeAt[workflow] : 0);
    }

    /// @notice Pins the first cron block expected on or after `reset`.
    function _pin(bytes32 workflow, uint64 reset) internal {
        uint64 target = _wakeBlock(reset);
        uint64 current = wakeAt[workflow];
        if (target == current) return;
        if (current != 0) _wakeFilter(current, false);
        wakeAt[workflow] = target;
        if (target != 0) _wakeFilter(target, true);
    }

    /// @notice Drops the pinned cron subscription of a workflow.
    function _unpin(bytes32 workflow) internal {
        uint64 target = wakeAt[workflow];
        if (target == 0) return;
        wakeAt[workflow] = 0;
        _wakeFilter(target, false);
    }

    /// @notice One exact cron block, used only by a paused workflow.
    function _wakeFilter(uint64 target, bool enabled) internal {
        _filterCron(target, enabled);
    }

    function _filterCron(uint256 topic1, bool enabled) internal {
        _filter(Filter(automationChain, cronSource, CRON, topic1, ANY), enabled);
    }

    /// @notice First `Cron100` block expected at or after `reset`, or zero when it has passed.
    /// @dev Per-chain block time constants are intentionally slower than observed block times, so
    /// the estimate lands shortly before reset and is corrected by another pin instead of resuming late.
    function _wakeBlock(uint64 reset) internal view returns (uint64) {
        if (reset <= block.timestamp) return 0;
        unchecked {
            uint256 blocksLeft = (uint256(reset - block.timestamp) * 1_000 + blockMs - 1) / blockMs;
            uint256 target = ((block.number + blocksLeft + 99) / 100) * 100;
            if (target > type(uint64).max) return 0;
            return uint64(target);
        }
    }

    /// @notice The next reset the mirrored budget will apply.
    function _resetAt(bytes32 workflow) internal view returns (uint64) {
        return budgets[workflow].weekStart + WEEK + WEEK_SKEW;
    }

    /// @notice True when every leaf would be rejected by the Vault's weekly budget.
    function _budgetBlocks(bytes32 workflow, uint256 observed) internal view returns (bool) {
        return _budgetBlocksAt(workflow, observed, uint64(block.timestamp));
    }

    /// @notice True when every leaf would be rejected even with the spend reset to zero.
    function _budgetBlocksFresh(bytes32 workflow, uint256 observed) internal view returns (bool) {
        return _budgetBlocksAt(workflow, observed, _resetAt(workflow));
    }

    function _budgetBlocksAt(bytes32 workflow, uint256 observed, uint64 asOf)
        internal
        view
        returns (bool)
    {
        Budget storage budget = budgets[workflow];
        if (!budget.known) return false;
        return validator.budgetBlocks(
            budget.usdcLimit,
            budget.wethLimit,
            budget.usdcSpent,
            budget.wethSpent,
            budget.weekStart,
            paths[workflow],
            observed,
            asOf
        );
    }
}

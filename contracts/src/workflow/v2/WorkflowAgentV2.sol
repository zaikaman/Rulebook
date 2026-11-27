// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AbstractPayer} from "@reactive/abstract-base/AbstractPayer.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../chain/ChainConfig.sol";
import {CallbackConfiguration, IReactiveSystem} from "../../shared/ReactiveTypes.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";
import {WorkflowProgramValidatorV2} from "./WorkflowProgramValidatorV2.sol";

interface IWorkflowSettlementV2 {
    function execute(address sender, bytes32 workflow, P.Run calldata run) external;
}

/// @notice Routes authenticated Reactive events to the wallet's chain-specific V2 Vault.
contract WorkflowAgentV2 is AbstractPayer {
    uint256 private constant ANY =
        0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 private constant CRON = uint256(keccak256("Cron100(uint256)"));
    uint256 private constant SYNC = uint256(keccak256("Sync(uint112,uint112)"));
    uint256 private constant SWAP_V3 =
        uint256(keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)"));
    uint256 private constant TRANSFER = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 private constant CLOSED = uint256(keccak256("Closed(bytes32,uint64)"));
    uint256 private constant BUDGET_SYNCED =
        uint256(keccak256("BudgetSynced(bytes32,uint96,uint96,uint128,uint128,uint64,uint32)"));
    uint256 private constant REFERENCE_SYNCED =
        uint256(keccak256("ReferenceSynced(bytes32,uint64,uint128)"));
    uint256 private constant GRACE_STARTED =
        uint256(keccak256("GraceStarted(bytes32,uint64,uint64)"));
    uint64 private constant LIFETIME = 10 minutes;
    uint64 private constant GRACE_SKEW = 2 minutes;
    uint64 public constant PRICE_COOLDOWN = 60 seconds;
    uint64 private constant CALLBACK_GAS = 850_000;
    uint8 private constant FLAG_REF_PENDING = 32;
    uint256 private constant PATH_MASK_104 = (uint256(1) << 104) - 1;
    uint256 private constant MAX_ACTIVE = 4;
    // Bounds the per-workflow waiting list so a burst of blocked triggers can never make a cron
    // retry or a later budget sync unbounded. Oldest runs are kept; the newest is reported dropped.
    uint256 private constant MAX_PENDING = 8;
    uint64 private constant WEEK = 7 days;
    // Reactive and destination chains can differ by seconds. The mirror only rolls a week forward
    // after the boundary has certainly passed on both chains, so the Agent never suppresses a run
    // the Vault would settle against the week the spend was recorded in.
    uint64 private constant WEEK_SKEW = 10 minutes;
    // Reactive blocks arrive near ~0.785s (Mainnet) to ~1.09s (Lasna). Conservative per-chain
    // block-time overestimates wake the agent shortly before reset while minimizing mainnet re-pins.
    uint256 private constant LASNA_BLOCK_MS = 2_000;
    uint256 private constant MAINNET_BLOCK_MS = 820;

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
    address public immutable factory;
    WorkflowProgramValidatorV2 public immutable validator;
    uint32 public immutable automationChain;
    address private immutable cronSource;
    uint32 private immutable primaryChain;
    uint32 private immutable secondaryChain;
    address private immutable primaryUsdc;
    address private immutable secondaryUsdc;
    address private immutable primaryPair;
    address private immutable secondaryPair;
    uint24 private immutable primaryPoolFee;
    uint24 private immutable secondaryPoolFee;
    bool private immutable primaryUsdc0;
    bool private immutable secondaryUsdc0;
    uint256 private immutable blockMs;
    address public owner;
    mapping(uint32 => address) public vaults;
    mapping(bytes32 => Entry) public entries;
    mapping(bytes32 => PriceHigh) private highs;
    mapping(bytes32 => bytes) public programs;
    mapping(bytes32 => uint256[]) private paths;
    mapping(bytes32 => WorkflowMeta) public meta;
    mapping(bytes32 => Budget) public budgets;
    mapping(bytes32 => string) public titles;
    mapping(bytes32 => bool) private seen;
    mapping(bytes32 => Pending[]) private pending;
    mapping(bytes32 => bool) private paused;
    mapping(bytes32 => uint64) private wakeAt;
    mapping(bytes32 => uint256) private subscriptions;
    bytes32[] private active;
    bytes32[] private known;
    mapping(bytes32 => bool) private retryWaiting;
    uint256 private retryWaitingCount;
    mapping(uint32 => mapping(address => PriceState)) private prices;
    uint64 private lastActivity;
    mapping(uint32 => ActivityCursor) private activityCursors;

    constructor(IReactiveSystem system_, address factory_, WorkflowProgramValidatorV2 validator_) {
        if (!ChainConfig.isAutomationChain(block.chainid)) revert InvalidWorkflow();
        system = system_;
        factory = factory_;
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
        secondaryUsdc0 = sCfg.usdc < sCfg.weth;
        blockMs = isMainnet ? MAINNET_BLOCK_MS : LASNA_BLOCK_MS;
    }

    function _market(uint32 chainId)
        private
        view
        returns (address usdc, address pair, uint24 poolFee, bool usdc0)
    {
        return chainId == primaryChain
            ? (primaryUsdc, primaryPair, primaryPoolFee, primaryUsdc0)
            : (secondaryUsdc, secondaryPair, secondaryPoolFee, secondaryUsdc0);
    }

    function initialize(address owner_) external {
        if (msg.sender != factory || owner != address(0) || owner_ == address(0)) {
            revert Unauthorized();
        }
        owner = owner_;
        vendor = IPayable(payable(address(system)));
        addAuthorizedSender(address(system));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function linkVault(uint32 chain, address vault) external onlyOwner {
        if (
            (chain != primaryChain && chain != secondaryChain) || vault == address(0)
                || vaults[chain] != address(0)
        ) {
            revert InvalidWorkflow();
        }
        vaults[chain] = vault;
    }

    function withdraw(uint256 amount) external onlyOwner {
        _pay(payable(owner), amount);
    }

    /// @notice Starts a new signed workflow epoch once the destination authorization has settled.
    function enable(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title,
        uint64 originAfter
    ) external onlyOwner {
        _enableCore(workflow, epoch, encoded, title, originAfter);
    }

    /// @notice Starts a new signed workflow epoch with an initial weekly budget snapshot.
    function enableWithBudget(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title,
        uint64 originAfter,
        BudgetSeed calldata budgetSeed
    ) external onlyOwner {
        if (budgetSeed.usdcLimit != 0 || budgetSeed.wethLimit != 0) {
            budgets[workflow] = Budget(
                budgetSeed.usdcLimit,
                budgetSeed.wethLimit,
                budgetSeed.usdcSpent,
                budgetSeed.wethSpent,
                budgetSeed.weekStart,
                budgetSeed.revision,
                true
            );
        } else {
            delete budgets[workflow];
        }
        _enableCore(workflow, epoch, encoded, title, originAfter);
    }

    function _enableCore(
        bytes32 workflow,
        uint64 epoch,
        bytes calldata encoded,
        string calldata title,
        uint64 originAfter
    ) private {
        P.AgentPlan memory plan = validator.inspectForAgent(encoded);
        Entry storage entry = entries[workflow];
        if (
            workflow == bytes32(0) || epoch <= entry.epoch || vaults[plan.chain] == address(0)
                || originAfter == 0 || bytes(title).length == 0 || bytes(title).length > 80
                || (plan.expires != 0 && plan.expires <= block.timestamp)
        ) revert InvalidWorkflow();
        if (entry.epoch == 0) known.push(workflow);
        if (
            msg.sig != this.enableWithBudget.selector
                && (entry.trigger == 0 || entry.chain != plan.chain)
        ) {
            delete budgets[workflow];
        }
        if (entry.trigger != 0) _stop(workflow, entry);
        if (active.length >= MAX_ACTIVE) revert InvalidWorkflow();
        bytes32 hash = keccak256(encoded);
        entry.hash = hash;
        entry.epoch = epoch;
        entry.nextDue = uint64(block.timestamp);
        entry.lasnaAfter = uint64(block.number);
        entry.trigger = plan.trigger;
        entry.chain = plan.chain;
        entry.interval = plan.interval;
        entry.expiry = plan.expires;
        entry.source = plan.source;
        entry.subject = plan.subject;
        entry.dip = (plan.flags & P.FLAG_DIP) != 0;
        entry.inactivity = (plan.flags & P.FLAG_INACTIVITY) != 0;
        entry.once = (plan.flags & P.FLAG_ONCE) != 0;
        entry.originAfter = originAfter;
        entry.originChain = plan.originChain;
        delete meta[workflow];
        meta[workflow].flags = plan.flags;
        delete highs[workflow];
        programs[hash] = encoded;
        paths[workflow] = plan.paths;
        titles[workflow] = title;
        active.push(workflow);
        _settlementFilters(workflow, entry, true);
        if (
            (entry.trigger == P.SCHEDULE || entry.trigger == P.PRICE)
                && (plan.flags & P.FLAG_SPENDS) != 0 && _budgetBlocks(workflow, 0)
        ) {
            _enterPause(workflow, entry);
        } else {
            _triggerFilters(entry, !paused[workflow]);
        }
        emit Enabled(workflow, hash, plan.chain, epoch, title);
    }

    function disable(bytes32 workflow, uint64 epoch) external onlyOwner {
        Entry storage entry = entries[workflow];
        if (entry.trigger == 0 || epoch != entry.epoch) revert InvalidWorkflow();
        _stop(workflow, entry);
        emit Disabled(workflow, epoch);
    }

    function workflowIds() external view returns (bytes32[] memory) {
        return known;
    }

    /// @notice Number of budget-blocked runs waiting for a retry on `workflow`.
    function pendingRuns(bytes32 workflow) external view returns (uint256) {
        return pending[workflow].length;
    }

    /// @notice True while an exhausted weekly budget has removed the workflow's trigger filters.
    function watchingPaused(bytes32 workflow) external view returns (bool) {
        return paused[workflow];
    }

    /// @notice Lasna block pinned for the next budget-reset wake, or zero when none is scheduled.
    function wakeBlock(bytes32 workflow) external view returns (uint64) {
        return wakeAt[workflow];
    }

    /// @notice Re-arms a paused workflow without waiting for its pinned wake.
    /// @dev Permissionless: the mirrored budget still has to admit a path, so this can only
    /// restore watching a run the Vault would settle. It is the recovery path if a targeted cron
    /// wake is ever missed while the Agent has no watching credit.
    function resumeWatching(bytes32 workflow) external {
        Entry storage entry = entries[workflow];
        if (entry.trigger == 0) revert NotPaused();
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

    function publication(bytes32 workflow)
        external
        view
        returns (bytes32 hash, uint32 chain, string memory title)
    {
        Entry storage entry = entries[workflow];
        if (entry.epoch == 0) revert InvalidWorkflow();
        return (entry.hash, entry.chain, titles[workflow]);
    }

    function _stop(bytes32 workflow, Entry storage entry) private {
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

    /// @notice Retires a workflow whose signed expiry has passed and records the terminal state.
    /// @dev The Vault can never settle this program again, so removing the filters and reporting
    /// the expiry is the only truthful outcome. The owner can still enable a new epoch later.
    function _retire(bytes32 workflow, Entry storage entry) private {
        uint64 epoch = entry.epoch;
        _stop(workflow, entry);
        emit Expired(workflow, epoch);
    }

    function _filters(bytes32 workflow, Entry storage entry, bool enabled) private {
        _settlementFilters(workflow, entry, enabled);
        _triggerFilters(entry, enabled);
    }

    /// @notice Filters that stay installed while a workflow is paused for its weekly budget.
    function _settlementFilters(bytes32 workflow, Entry storage entry, bool enabled) private {
        address vault = vaults[entry.chain];
        uint8 flags = meta[workflow].flags;
        if ((flags & P.FLAG_SPENDS) != 0) {
            _filter(Filter(entry.chain, vault, BUDGET_SYNCED, uint256(workflow), ANY), enabled);
        }
        if (entry.once) {
            _filter(
                Filter(entry.chain, vault, CLOSED, uint256(workflow), uint256(entry.epoch)), enabled
            );
        }
        if ((flags & P.FLAG_USES_REFERENCE) != 0) {
            _filter(
                Filter(
                    entry.chain, vault, REFERENCE_SYNCED, uint256(workflow), uint256(entry.epoch)
                ),
                enabled
            );
        }
        if (entry.inactivity) {
            _filter(Filter(primaryChain, primaryUsdc, TRANSFER, uint160(owner), ANY), enabled);
            _filter(Filter(secondaryChain, secondaryUsdc, TRANSFER, uint160(owner), ANY), enabled);
            _filter(
                Filter(entry.chain, vault, GRACE_STARTED, uint256(workflow), uint256(entry.epoch)),
                enabled
            );
        }
    }

    /// @notice Filters that only exist to trigger a run, and are removed while watching is paused.
    function _triggerFilters(Entry storage entry, bool enabled) private {
        (address originUsdc, address originPair, uint24 originPoolFee,) = _market(entry.originChain);
        uint256 priceTopic = originPoolFee == 0 ? SYNC : SWAP_V3;
        if (entry.trigger == P.SCHEDULE) {
            _filterCron(ANY, enabled);
            if (entry.dip) {
                _filter(Filter(entry.originChain, originPair, priceTopic, ANY, ANY), enabled);
            }
        } else if (entry.trigger == P.PRICE) {
            _filter(Filter(entry.originChain, originPair, priceTopic, ANY, ANY), enabled);
        } else if (entry.trigger == P.PAYMENT) {
            _filter(
                Filter(entry.originChain, originUsdc, TRANSFER, ANY, uint160(vaults[entry.chain])),
                enabled
            );
        } else if (entry.trigger == P.TRANSFER) {
            uint160 destination =
                uint160(entry.subject == address(0) ? vaults[entry.chain] : entry.subject);
            if (entry.subject != address(0)) {
                _filter(
                    Filter(entry.originChain, entry.source, TRANSFER, destination, ANY), enabled
                );
            }
            _filter(Filter(entry.originChain, entry.source, TRANSFER, ANY, destination), enabled);
        }
    }

    function _filter(Filter memory filter, bool enabled) private {
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

    /// @notice Reacts to the exact configured emitters and dispatches one request per workflow and log.
    function react(IReactive.LogRecord calldata log) external {
        if (msg.sender != address(system)) revert Unauthorized();
        if (log.log_index > type(uint64).max || log.block_number > type(uint64).max) return;
        if (log.topic_0 == BUDGET_SYNCED) {
            _syncBudget(log);
            return;
        }
        if (
            log.topic_0 == REFERENCE_SYNCED || log.topic_0 == GRACE_STARTED || log.topic_0 == CLOSED
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
                if (block.timestamp > lastActivity) lastActivity = uint64(block.timestamp);
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
                }
                WorkflowMeta storage info = meta[workflow];
                uint256 refPrice = (info.flags & FLAG_REF_PENDING) != 0
                    && block.timestamp < uint256(info.cooldownUntil) + LIFETIME
                    ? type(uint256).max
                    : info.referencePrice;
                if (!validator.canTriggerPrice(
                        programs[entry.hash], state.price, state.previousPrice, high.value, refPrice
                    )) return;
                if (block.timestamp < info.cooldownUntil) return;
                run.observed = state.price;
                run.previous = state.previousPrice;
                run.high = high.value;
                run.highBlock = high.blockNumber;
                run.observationTime = state.time;
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
        // A run the Vault can only reject on budget would still cost a callback fee, so it is not
        // requested now. The schedule retries on its next tick. A payment or transfer origin is a
        // single log, so it is parked in the bounded waiting list and retried when the budget
        // changes or a cron tick sees the week reset. Refusing to dispatch never consumes the run.
        if (_budgetBlocks(workflow, run.observed)) {
            if (entry.trigger == P.PAYMENT || entry.trigger == P.TRANSFER) _park(workflow, run);
            else _pause(workflow, entry);
            return;
        }
        seen[runId] = true;
        _dispatch(workflow, entry, run, runId);
    }

    /// @notice Commits a run: advances a schedule and requests the settlement callback.
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

    /// @notice Parks a budget-blocked payment or transfer run until its budget recovers.
    /// @dev Deduplicated on the origin log and bounded by `MAX_PENDING`. A workflow whose parked
    /// runs are all budget-blocked never keeps the wildcard cron filter alive: if any parked run
    /// can fit after the week resets it pins that single reset block, otherwise it waits passively
    /// for a budget edit.
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

    /// @notice Retries eligible active workflows' waiting lists on a cron tick.
    /// @dev Retrying an expired workflow retires it and shrinks `active`, so the index only moves
    /// when the workflow it pointed at is still present.
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

    /// @notice Dispatches at most one waiting run for `workflow` when the budget now allows it.
    /// @dev One run per call: the mirrored spend only advances once the Vault's outcome arrives, so
    /// dispatching a batch could request runs the Vault would then reject.
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

    /// @notice Removes one parked run while preserving FIFO order.
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

    /// @notice Drops every parked run for a workflow whose epoch or trigger just changed.
    function _clearPending(bytes32 workflow) private {
        if (pending[workflow].length == 0) return;
        delete pending[workflow];
        _setRetryWaiting(workflow, false);
    }

    /// @notice Updates wildcard cron vs targeted reset wake subscriptions for `workflow`'s queue.
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

    function _setRetryWaiting(bytes32 workflow, bool waiting) private {
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
    function _cronFilter(bool enabled) private {
        _filterCron(ANY, enabled);
    }

    /// @notice Removes the trigger filters of a workflow whose weekly budget cannot fund any path.
    /// @dev The settlement filters stay installed, so a budget edit published by the Vault resumes
    /// watching. A schedule or price run is deterministic enough to prove futile; payment and
    /// transfer triggers keep watching because their origin log is the only copy of the run.
    function _pause(bytes32 workflow, Entry storage entry) private {
        if (paused[workflow]) return;
        paused[workflow] = true;
        _triggerFilters(entry, !paused[workflow]);
        _enterPause(workflow, entry);
    }

    function _enterPause(bytes32 workflow, Entry storage entry) private {
        paused[workflow] = true;
        uint64 reset = _resetAt(workflow);
        bool recoverable = !_budgetBlocksFresh(workflow, 0);
        if (recoverable) _pin(workflow, reset);
        emit WatchingPaused(workflow, entry.epoch, recoverable ? wakeAt[workflow] : 0);
    }

    /// @notice Restores the trigger filters after a budget proves a path can run again.
    function _resume(bytes32 workflow, Entry storage entry) private {
        if (!paused[workflow]) return;
        paused[workflow] = false;
        meta[workflow].cooldownUntil = 0;
        _unpin(workflow);
        _triggerFilters(entry, !paused[workflow]);
        emit WatchingResumed(workflow, entry.epoch);
    }

    /// @notice Handles the one cron block pinned for a paused workflow.
    /// @dev Before the reset it only moves the pin forward; on or after the reset it restores the
    /// normal filters and lets the next cron tick dispatch. Lasna allows a reactive contract to
    /// replace its own subscription from inside react(), which is what makes the re-pin possible.
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

    /// @notice Pins the first cron block expected on or after `reset`.
    function _pin(bytes32 workflow, uint64 reset) private {
        uint64 target = _wakeBlock(reset);
        uint64 current = wakeAt[workflow];
        if (target == current) return;
        if (current != 0) _wakeFilter(current, false);
        wakeAt[workflow] = target;
        if (target != 0) _wakeFilter(target, true);
    }

    /// @notice Drops the pinned cron subscription of a workflow.
    function _unpin(bytes32 workflow) private {
        uint64 target = wakeAt[workflow];
        if (target == 0) return;
        wakeAt[workflow] = 0;
        _wakeFilter(target, false);
    }

    /// @notice One exact cron block, used only by a paused workflow.
    function _wakeFilter(uint64 target, bool enabled) private {
        _filterCron(target, enabled);
    }

    function _filterCron(uint256 topic1, bool enabled) private {
        _filter(Filter(automationChain, cronSource, CRON, topic1, ANY), enabled);
    }

    /// @notice First `Cron100` block expected at or after `reset`, or zero when it has passed.
    /// @dev Per-chain block time constants are intentionally slower than observed block times, so
    /// the estimate lands shortly before reset and is corrected by another pin instead of resuming late.
    function _wakeBlock(uint64 reset) private view returns (uint64) {
        if (reset <= block.timestamp) return 0;
        unchecked {
            uint256 blocksLeft = (uint256(reset - block.timestamp) * 1_000 + blockMs - 1) / blockMs;
            uint256 target = ((block.number + blocksLeft + 99) / 100) * 100;
            if (target > type(uint64).max) return 0;
            return uint64(target);
        }
    }

    /// @notice The next reset the mirrored budget will apply.
    function _resetAt(bytes32 workflow) private view returns (uint64) {
        return budgets[workflow].weekStart + WEEK + WEEK_SKEW;
    }

    /// @notice The same run id the Vault derives for a dispatch.
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

    /// @notice True when every leaf would be rejected by the Vault's weekly budget.
    /// @dev The mirrored budget is never larger than the Vault's own spend and never newer than the
    /// week the Vault would settle against, so this can only suppress runs the Vault would skip.
    function _budgetBlocks(bytes32 workflow, uint256 observed) private view returns (bool) {
        return _budgetBlocksAt(workflow, observed, uint64(block.timestamp));
    }

    /// @notice True when every leaf would be rejected even with the spend reset to zero.
    /// @dev A path above the configured limit can never run; such a workflow is paused without a
    /// reset wake, and only a budget edit that admits a path brings it back.
    function _budgetBlocksFresh(bytes32 workflow, uint256 observed) private view returns (bool) {
        return _budgetBlocksAt(workflow, observed, _resetAt(workflow));
    }

    function _budgetBlocksAt(bytes32 workflow, uint256 observed, uint64 asOf)
        private
        view
        returns (bool)
    {
        Budget storage budget = budgets[workflow];
        if (!budget.known) return false;
        uint128 usdcSpent = budget.usdcSpent;
        uint128 wethSpent = budget.wethSpent;
        if (asOf >= uint256(budget.weekStart) + WEEK + WEEK_SKEW) {
            usdcSpent = 0;
            wethSpent = 0;
        }
        uint256[] storage plan = paths[workflow];
        uint256 count = plan.length;
        if (count == 0) return false;
        for (uint256 index; index < count; ++index) {
            uint256 packed = plan[index];
            if ((packed >> 232) != 0) continue;
            uint256 usdc = packed & PATH_MASK_104;
            uint256 weth = (packed >> 104) & PATH_MASK_104;
            uint256 percent = (packed >> 208) & 0xffff;
            uint256 percents = (packed >> 224) & 0xff;
            if (percent != 0) {
                // Flooring each percentage step separately is worth at least the aggregate floor
                // minus one unit per extra step, so this stays a lower bound of the real spend.
                uint256 aggregated = Math.mulDiv(observed, percent, P.BPS);
                uint256 floorLoss = percents - 1;
                if (aggregated > floorLoss) {
                    uint256 part = aggregated - floorLoss;
                    usdc = part > type(uint256).max - usdc ? type(uint256).max : usdc + part;
                }
            }
            if (_exceeds(budget.usdcLimit, usdcSpent, usdc)) continue;
            if (_exceeds(budget.wethLimit, wethSpent, weth)) continue;
            return false;
        }
        return true;
    }

    /// @notice True when `cost` cannot fit in `limit` after `spent`. A zero limit is unlimited.
    function _exceeds(uint96 limit, uint128 spent, uint256 cost) private pure returns (bool) {
        if (cost == 0 || limit == 0) return false;
        if (spent >= limit) return true;
        return cost > uint256(limit) - uint256(spent);
    }

    /// @notice Keeps the mirrored weekly budget in step with the Vault's published snapshot.
    /// @dev Only a strictly newer snapshot wins, so reordered or repeated delivery cannot undo a
    /// recorded spend; a different week start always wins because it carries the reset.
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
        if (
            budget.known
                && (weekStart < budget.weekStart
                    || (weekStart == budget.weekStart
                        && (revision < budget.revision
                            || usdcSpent < budget.usdcSpent
                            || wethSpent < budget.wethSpent)))
        ) return;
        uint64 prevWeek = budget.weekStart;
        budgets[workflow] =
            Budget(usdcLimit, wethLimit, usdcSpent, wethSpent, weekStart, revision, true);
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
}

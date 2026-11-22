// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AbstractPayer} from "@reactive/abstract-base/AbstractPayer.sol";
import {IPayable} from "@reactive/interfaces/IPayable.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";
import {ChainConfig} from "../../chain/ChainConfig.sol";
import {PriceMath} from "../../libraries/PriceMath.sol";
import {CallbackConfiguration, IReactiveSystem} from "../../shared/ReactiveTypes.sol";
import {WorkflowProgramV2 as P} from "./WorkflowProgramV2.sol";

interface IWorkflowSettlementV2 {
    function execute(address sender, bytes32 workflow, P.Run calldata run) external;
}

/// @notice Routes authenticated Lasna events to the wallet's chain-specific V2 Vault.
contract WorkflowAgentV2 is AbstractPayer {
    uint32 private constant LASNA = 5_318_007;
    uint256 private constant ANY =
        0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 private constant CRON = uint256(keccak256("Cron100(uint256)"));
    uint256 private constant SYNC = uint256(keccak256("Sync(uint112,uint112)"));
    uint256 private constant TRANSFER = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 private constant CLOSED = uint256(keccak256("Closed(bytes32,uint64)"));
    uint256 private constant BUDGET_SYNCED =
        uint256(keccak256("BudgetSynced(bytes32,uint96,uint96,uint128,uint128,uint64,uint32)"));
    uint64 private constant LIFETIME = 10 minutes;
    uint64 private constant CALLBACK_GAS = 850_000;
    uint256 private constant MAX_ACTIVE = 4;
    uint64 private constant WEEK = 7 days;
    // Unix time zero is a Thursday, so this shift floors timestamps to Monday 00:00 UTC, matching
    // the Vault's week boundary exactly.
    uint64 private constant MONDAY_SHIFT = 3 days;
    // Reactive Lasna and Unichain Sepolia timestamps can differ by seconds. The mirror only rolls a
    // week forward after the boundary has certainly passed on both chains, so the Agent never
    // suppresses a run the Vault would settle against the week the spend was recorded in.
    uint64 private constant WEEK_SKEW = 10 minutes;

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

    /// @notice Smallest USDC and WETH amount a leaf can consume, recorded when it is installed.
    /// @dev `percents` counts the percentage steps so the aggregate product can be turned back into
    /// a lower bound of the Vault's per-step flooring.
    struct PathCost {
        uint128 usdc;
        uint128 weth;
        uint16 percent;
        uint8 percents;
        bool empty;
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

    error Unauthorized();
    error InvalidWorkflow();
    event Enabled(
        bytes32 indexed workflow,
        bytes32 indexed programHash,
        uint32 chain,
        uint64 epoch,
        string title
    );
    event Disabled(bytes32 indexed workflow, uint64 epoch);
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
    address public owner;
    mapping(uint32 => address) public vaults;
    mapping(bytes32 => Entry) public entries;
    mapping(bytes32 => PriceHigh) private highs;
    mapping(bytes32 => bytes) public programs;
    mapping(bytes32 => PathCost[]) private paths;
    mapping(bytes32 => Budget) public budgets;
    mapping(bytes32 => string) public titles;
    mapping(bytes32 => bool) private seen;
    mapping(bytes32 => uint256) private subscriptions;
    bytes32[] private active;
    bytes32[] private known;
    uint128 private price;
    uint128 private previousPrice;
    uint64 private priceTime;
    bytes32 private priceObservation;
    uint256 private priceBlock;
    uint256 private priceIndex;
    uint64 private lastActivity;
    uint256 private activityBlock;
    uint256 private activityIndex;

    constructor(IReactiveSystem system_, address factory_) {
        system = system_;
        factory = factory_;
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
        if (chain != P.UNICHAIN_SEPOLIA || vault == address(0) || vaults[chain] != address(0)) {
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
        P.Program memory program = P.validate(encoded);
        Entry storage entry = entries[workflow];
        if (
            workflow == bytes32(0) || epoch <= entry.epoch || vaults[program.chain] == address(0)
                || originAfter == 0 || bytes(title).length == 0 || bytes(title).length > 80
        ) revert InvalidWorkflow();
        if (entry.epoch == 0) known.push(workflow);
        if (entry.trigger != 0) _stop(workflow, entry);
        if (active.length >= MAX_ACTIVE) revert InvalidWorkflow();
        bytes32 hash = keccak256(encoded);
        entry.hash = hash;
        entry.epoch = epoch;
        entry.nextDue = uint64(block.timestamp);
        entry.lasnaAfter = uint64(block.number);
        entry.trigger = program.trigger;
        entry.chain = program.chain;
        entry.interval = program.interval;
        entry.expiry = program.expires;
        entry.source = program.source;
        entry.subject = program.subject;
        entry.dip = P.hasCheck(program, P.DIP_BY);
        entry.inactivity = P.hasCheck(program, P.INACTIVITY);
        entry.once = program.once;
        entry.originAfter = originAfter;
        delete highs[workflow];
        programs[hash] = encoded;
        _paths(workflow, program);
        titles[workflow] = title;
        active.push(workflow);
        _filters(entry, true);
        emit Enabled(workflow, hash, program.chain, epoch, title);
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
        _filters(entry, false);
        entry.trigger = 0;
        for (uint256 index; index < active.length; ++index) {
            if (active[index] != workflow) continue;
            active[index] = active[active.length - 1];
            active.pop();
            break;
        }
    }

    function _filters(Entry storage entry, bool enabled) private {
        ChainConfig.Config memory cfg = ChainConfig.unichainSepolia();
        _filter(Filter(entry.chain, vaults[entry.chain], BUDGET_SYNCED, ANY, ANY), enabled);
        if (entry.once) {
            _filter(Filter(entry.chain, vaults[entry.chain], CLOSED, ANY, ANY), enabled);
        }
        if (entry.trigger == P.SCHEDULE) {
            _filter(Filter(LASNA, cfg.cronSource, CRON, ANY, ANY), enabled);
            if (entry.dip) _filter(Filter(P.UNICHAIN_SEPOLIA, cfg.pair, SYNC, ANY, ANY), enabled);
            if (entry.inactivity) {
                _filter(
                    Filter(P.UNICHAIN_SEPOLIA, cfg.usdc, TRANSFER, uint160(owner), ANY), enabled
                );
            }
        } else if (entry.trigger == P.PRICE) {
            _filter(Filter(P.UNICHAIN_SEPOLIA, cfg.pair, SYNC, ANY, ANY), enabled);
        } else if (entry.trigger == P.PAYMENT) {
            _filter(
                Filter(entry.chain, cfg.usdc, TRANSFER, ANY, uint160(vaults[entry.chain])), enabled
            );
        } else if (entry.trigger == P.TRANSFER) {
            uint160 destination =
                uint160(entry.subject == address(0) ? vaults[entry.chain] : entry.subject);
            if (entry.subject != address(0)) {
                _filter(Filter(entry.chain, entry.source, TRANSFER, destination, ANY), enabled);
            }
            _filter(Filter(entry.chain, entry.source, TRANSFER, ANY, destination), enabled);
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
        if (log.topic_0 == CLOSED) {
            bytes32 workflow = bytes32(log.topic_1);
            Entry storage entry = entries[workflow];
            if (
                entry.trigger != 0 && entry.once && log.chain_id == entry.chain
                    && log._contract == vaults[entry.chain] && log.topic_2 == entry.epoch
            ) {
                _stop(workflow, entry);
                emit Disabled(workflow, entry.epoch);
            }
            return;
        }
        ChainConfig.Config memory cfg = ChainConfig.unichainSepolia();
        bool market = log.chain_id == P.UNICHAIN_SEPOLIA && log._contract == cfg.pair
            && log.topic_0 == SYNC && _recordPrice(cfg, log);
        if (
            log.chain_id == P.UNICHAIN_SEPOLIA && log._contract == cfg.usdc
                && log.topic_0 == TRANSFER && log.topic_1 == uint160(owner)
                && log.topic_2 != log.topic_1 && log.data.length == 32
                && (log.block_number > activityBlock
                    || (log.block_number == activityBlock && log.log_index > activityIndex))
                && abi.decode(log.data, (uint256)) != 0
        ) {
            activityBlock = log.block_number;
            activityIndex = log.log_index;
            lastActivity = uint64(block.timestamp);
        }
        for (uint256 index; index < active.length; ++index) {
            _route(active[index], log, cfg, market);
        }
    }

    function _recordPrice(ChainConfig.Config memory cfg, IReactive.LogRecord calldata log)
        private
        returns (bool)
    {
        if (
            log.data.length != 64 || log.block_number < priceBlock
                || (log.block_number == priceBlock && log.log_index <= priceIndex)
        ) return false;
        (uint256 first, uint256 second) = abi.decode(log.data, (uint256, uint256));
        if (first == 0 || second == 0 || first > type(uint112).max || second > type(uint112).max) {
            return false;
        }
        uint256 observed = cfg.usdc < cfg.weth
            ? PriceMath.usdcPerWeth(uint112(first), uint112(second))
            : PriceMath.usdcPerWeth(uint112(second), uint112(first));
        if (observed == 0 || observed > type(uint128).max) return false;
        priceBlock = log.block_number;
        priceIndex = log.log_index;
        priceTime = uint64(block.timestamp);
        priceObservation = keccak256(abi.encode(log.tx_hash, log.log_index));
        previousPrice = price;
        price = uint128(observed);
        return true;
    }

    function _route(
        bytes32 workflow,
        IReactive.LogRecord calldata log,
        ChainConfig.Config memory cfg,
        bool market
    ) private {
        Entry storage entry = entries[workflow];
        if (entry.expiry != 0 && block.timestamp > entry.expiry) return;
        P.Run memory run;
        if (entry.trigger == P.SCHEDULE) {
            if (
                log.chain_id != LASNA || log._contract != cfg.cronSource || log.topic_0 != CRON
                    || log.topic_1 != log.block_number || log.block_number <= entry.lasnaAfter
                    || block.timestamp < entry.nextDue
            ) return;
            if (entry.dip) {
                run.observed = price;
                run.previous = previousPrice;
                run.observationTime = priceTime;
                run.observationId = priceObservation;
            }
            if (entry.inactivity) run.activityTime = lastActivity;
        } else {
            if (log.chain_id != entry.chain || log.block_number <= entry.originAfter) return;
            if (entry.trigger == P.PRICE) {
                if (!market) return;
                PriceHigh storage high = highs[workflow];
                if (price > high.value) {
                    high.value = price;
                    high.blockNumber = uint64(log.block_number);
                }
                run.observed = price;
                run.previous = previousPrice;
                run.high = high.value;
                run.highBlock = high.blockNumber;
                run.observationTime = priceTime;
            } else {
                if (log.data.length != 32) return;
                uint256 amount = abi.decode(log.data, (uint256));
                if (amount == 0) return;
                if (entry.trigger == P.PAYMENT) {
                    if (
                        log._contract != cfg.usdc || log.topic_0 != TRANSFER
                            || log.topic_2 != uint160(vaults[entry.chain])
                            || log.topic_1 == log.topic_2
                    ) return;
                    run.actor = address(uint160(log.topic_1));
                } else if (entry.trigger == P.TRANSFER) {
                    if (log._contract != entry.source || log.topic_0 != TRANSFER) return;
                    if (entry.subject == address(0)) {
                        if (
                            log.topic_2 != uint160(vaults[entry.chain])
                                || log.topic_1 == log.topic_2
                        ) return;
                    } else if (
                        log.topic_1 != uint160(entry.subject)
                            && log.topic_2 != uint160(entry.subject)
                    ) {
                        return;
                    }
                    run.actor = address(
                        uint160(
                            entry.subject != address(0) && log.topic_1 == uint160(entry.subject)
                                ? log.topic_2
                                : log.topic_1
                        )
                    );
                }
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
        bytes32 runId = keccak256(
            abi.encode(
                address(this), workflow, run.originChain, run.originTransaction, run.originLogIndex
            )
        );
        if (seen[runId]) return;
        seen[runId] = true;
        // A run the Vault can only reject on budget would still cost a callback fee, so it is never
        // requested. The schedule is deliberately left in place: the next tick retries and fires as
        // soon as the week resets or the limits are raised.
        if (_budgetBlocks(workflow, run.observed)) return;
        if (entry.trigger == P.SCHEDULE) {
            uint256 due = entry.nextDue;
            entry.nextDue =
                uint64(due + (1 + (block.timestamp - due) / entry.interval) * entry.interval);
            entry.lasnaAfter = uint64(log.block_number);
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

    /// @notice Records the smallest spend each leaf can produce, so a dispatch can be proven futile.
    /// @dev Only amounts derived from the signed program and the triggering observation are used.
    /// Every Vault decision that depends on live destination state stays unknown here, and an
    /// unknown leaf keeps the workflow dispatching.
    function _paths(bytes32 workflow, P.Program memory program) private {
        delete paths[workflow];
        for (uint256 index; index < program.nodes.length; ++index) {
            P.Node memory node = program.nodes[index];
            if (node.check != 0) continue;
            PathCost memory cost;
            cost.empty = node.actions.length == 0;
            for (uint256 step; step < node.actions.length; ++step) {
                P.Action memory action = node.actions[step];
                if (action.kind == P.ALERT) continue;
                if (action.unit == P.PERCENT) {
                    cost.percent += uint16(action.amount);
                    cost.percents += 1;
                } else if (action.kind == P.SELL) {
                    cost.weth += action.amount;
                } else if (action.kind == P.REFILL) {
                    // The Vault pulls at most the deficit below the threshold and at least one unit.
                    cost.usdc += 1;
                } else {
                    cost.usdc += action.amount;
                }
            }
            paths[workflow].push(cost);
        }
    }

    /// @notice True when every leaf would be rejected by the Vault's weekly budget.
    /// @dev The mirrored budget is never larger than the Vault's own spend and never newer than the
    /// week the Vault would settle against, so this can only suppress runs the Vault would skip.
    function _budgetBlocks(bytes32 workflow, uint256 observed) private view returns (bool) {
        PathCost[] storage plan = paths[workflow];
        uint256 count = plan.length;
        if (count == 0) return false;
        Budget memory budget = budgets[workflow];
        if (!budget.known) return false;
        uint128 usdcSpent = budget.usdcSpent;
        uint128 wethSpent = budget.wethSpent;
        if (block.timestamp >= uint256(budget.weekStart) + WEEK + WEEK_SKEW) {
            usdcSpent = 0;
            wethSpent = 0;
        }
        for (uint256 index; index < count; ++index) {
            PathCost memory cost = plan[index];
            if (cost.empty) continue;
            uint256 usdc = cost.usdc;
            if (cost.percent != 0) {
                // Flooring each percentage step separately is worth at least the aggregate floor
                // minus one unit per extra step, so this stays a lower bound of the real spend.
                uint256 aggregated = Math.mulDiv(observed, cost.percent, P.BPS);
                uint256 floorLoss = uint256(cost.percents) - 1;
                if (aggregated > floorLoss) usdc += aggregated - floorLoss;
            }
            if (_exceeds(budget.usdcLimit, usdcSpent, usdc)) continue;
            if (_exceeds(budget.wethLimit, wethSpent, cost.weth)) continue;
            return false;
        }
        return true;
    }

    /// @notice True when `cost` cannot fit in `limit` after `spent`. A zero limit is unlimited.
    function _exceeds(uint96 limit, uint128 spent, uint256 cost) private pure returns (bool) {
        return limit != 0 && uint256(spent) + cost > limit;
    }

    /// @notice Keeps the mirrored weekly budget in step with the Vault's published snapshot.
    /// @dev Only a strictly newer snapshot wins, so reordered or repeated delivery cannot undo a
    /// recorded spend; a different week start always wins because it carries the reset.
    function _syncBudget(IReactive.LogRecord calldata log) private {
        if (
            log.chain_id != P.UNICHAIN_SEPOLIA || log._contract != vaults[P.UNICHAIN_SEPOLIA]
                || log.data.length != 192 || entries[bytes32(log.topic_1)].epoch == 0
        ) return;
        bytes32 workflow = bytes32(log.topic_1);
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
        budgets[workflow] =
            Budget(usdcLimit, wethLimit, usdcSpent, wethSpent, weekStart, revision, true);
    }

    /// @notice Monday 00:00 UTC at or before `timestamp`, matching the Vault's boundary.
    function _weekStart(uint256 timestamp) private pure returns (uint64) {
        uint256 remainder = (timestamp + MONDAY_SHIFT) % WEEK;
        return uint64(timestamp >= remainder ? timestamp - remainder : 0);
    }
}

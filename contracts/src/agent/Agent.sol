// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

import {AgentRulePolicy, Subscription} from "./AgentRulePolicy.sol";
import {ChainConfig} from "../chain/ChainConfig.sol";
import {PriceMath} from "../libraries/PriceMath.sol";
import {RuleLib} from "../libraries/RuleLib.sol";
import {IRuleRegistry} from "../registry/IRuleRegistry.sol";
import {CallbackPayload, ExecutionPayload, MirrorPayload} from "../shared/CallbackPayload.sol";
import {CallbackConfiguration, IReactiveSystem} from "../shared/ReactiveTypes.sol";
import {
    AgentNotLinked,
    CooldownActive,
    ExceedsPerRunCap,
    InvalidAmount,
    InvalidSecondary,
    InvalidTemplateParams,
    MirrorDepthNotAllowed,
    MonthlyCapExceeded,
    NotOwner,
    NotServiceProvider,
    RegistryNotConfigured,
    RuleLimitReached,
    RuleNotActive
} from "../shared/Errors.sol";

/// @title Agent
/// @notice One user's automation account on Reactive Lasna: rule storage, evaluation order,
/// the per-pair price cache, and the `react()` entry point.
/// @dev `react()` never moves funds and never changes subscriptions; it only decides and requests.
contract Agent is Ownable {
    uint8 private constant MAX_MIRRORS_PER_HOUR = 10;
    uint256 private constant ANY_TOPIC =
        0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;

    /// @notice A mirror attachment for a leader execution.
    struct MirrorConfig {
        uint256 leaderChainId;
        address leaderVault;
        uint256 leaderRuleId;
        uint16 scaleBps;
        uint256 perRunCap;
        uint8 hourlyCap;
        address leaderAgent;
        address tokenIn;
    }

    struct MirrorWindow {
        uint64[MAX_MIRRORS_PER_HOUR] timestamps;
        uint8 next;
    }

    /// @notice Emitted for every rule the owner creates.
    event RuleCreated(
        address indexed agent, uint256 indexed ruleId, uint8 template, bool publicRule
    );
    /// @notice Emitted when a rule is paused (`true`) or resumed (`false`).
    event RulePaused(address indexed agent, uint256 indexed ruleId, bool paused);
    /// @notice Emitted when a rule is cancelled.
    event RuleCancelled(address indexed agent, uint256 indexed ruleId);
    event RuleReplaced(uint256 indexed oldRuleId, uint256 indexed newRuleId);
    event RuleLatchChanged(uint256 indexed ruleId, bool latched);
    /// @notice Emitted for every rule evaluated by `react()`, fired or not.
    event RuleEvaluated(
        uint256 indexed ruleId,
        uint256 indexed originChainId,
        bytes32 originTxHash,
        uint32 originLogIndex,
        bool fired
    );
    /// @notice Emitted when an alert template fires. Alerts never request a callback.
    event AlertRaised(uint256 indexed ruleId, uint8 template, uint256 observed);
    /// @notice Emitted when the gas guard defers rules to the next wake-up.
    event EvaluationDeferred(uint256 indexed ruleId, uint256 gasRemaining);
    /// @notice Emitted when an account's execution credit falls below the warning threshold.
    event BudgetLow(uint256 reserved, uint256 threshold);
    /// @notice Emitted when the owner links a funds-side vault.
    event VaultLinked(uint256 indexed chainId, address indexed vault);
    /// @notice Records the active mirror relationship for the read model.
    event MirrorAttached(
        uint256 indexed ruleId,
        address indexed leaderAgent,
        address indexed leaderVault,
        uint256 leaderRuleId,
        uint16 scaleBps,
        uint256 perRunCap,
        uint8 hourlyCap
    );
    /// @notice Removes a mirror relationship from the read model.
    event MirrorDetached(uint256 indexed ruleId);
    /// @notice Links a follower's callback request to the leader's funds-side transaction.
    event MirrorCallbackRequested(
        bytes32 indexed leaderTx, address indexed leaderVault, uint256 indexed ruleId
    );

    /// @notice Topic0 of a Uniswap V2 pair's `Sync` event.
    bytes32 internal constant SYNC_TOPIC = keccak256("Sync(uint112,uint112)");
    bytes32 internal constant HOURLY_CRON_TOPIC = keccak256("Cron100(uint256)");
    bytes32 internal constant DAILY_CRON_TOPIC = keccak256("Cron10000(uint256)");
    bytes32 private constant GRID_SETTLED_TOPIC = keccak256("GridSettled(uint256,uint32)");
    /// @notice Topic0 of an ERC20 `Transfer`.
    bytes32 internal constant TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");
    /// @notice Topic0 of the Vault's `Balances` event.
    bytes32 internal constant BALANCES_TOPIC =
        keccak256("Balances(address,uint256,address,uint256)");
    bytes32 private constant SWAP_FUNDS_TOPIC =
        keccak256("ScheduledSwapFunds(address,uint256,uint256,uint256,uint32)");
    bytes32 internal constant EXECUTED_TOPIC =
        keccak256("Executed(uint256,address,address,uint256,uint256,uint256)");

    /// @notice Hard ceiling for one rule's spend per run (FR-015, FR-027). The Vault's own
    /// `maxSpendPerRun` is the funds-side ceiling; the Agent cannot read it across chains, so
    /// this is the pre-approval bound enforced at `addRule`.
    uint256 public constant MAX_SPEND_PER_RUN = 100_000_000;
    /// @notice Monthly pre-approval across all active rules (IDEA.md §11). The sum of every
    /// active rule's per-run amount may never exceed this; pausing releases its reservation.
    uint256 public constant MONTHLY_SPEND_CAP = 300_000_000;
    /// @notice Remaining cap at or below which `BudgetLow` is emitted, warning before silence.
    uint256 public constant BUDGET_LOW_THRESHOLD = MONTHLY_SPEND_CAP / 10;
    /// @notice Reactive's per-transaction ceiling; the guard stops before reaching it.
    uint256 public constant MAX_REACT_GAS = 900_000;
    /// @notice Gas kept in hand so the deferred events and the return path always fit.
    uint256 public constant REACT_GAS_RESERVE = 45_000;
    /// @notice Conservative cost of evaluating one rule, including its event.
    uint256 public constant EVALUATION_GAS_ESTIMATE = 60_000;
    uint256 private constant MIRROR_GAS_ESTIMATE = 150_000;
    /// @notice Rolling accounting window for the per-user monthly execution cap.
    uint64 public constant MONTHLY_WINDOW = 30 days;

    /// @notice Callback gas requested for a swap, including proxy overhead.
    uint64 public constant SWAP_CALLBACK_GAS = 500_000;
    /// @notice Mirror swaps also check provenance, replay protection and the received amount.
    uint64 public constant MIRROR_CALLBACK_GAS = 750_000;
    /// @notice Callback gas requested for a transfer or pull, including proxy overhead.
    uint64 public constant TRANSFER_CALLBACK_GAS = 300_000;
    /// @notice Tolerance baked into a mirror's decision-time output floor.
    uint256 public constant DECISION_SLIPPAGE_BPS = 200;
    uint64 private constant EXECUTION_LIFETIME = 10 minutes;
    uint256 private constant FUNDING_OBSERVATION_LIFETIME = 1 days;
    /// @notice Default cron interval used when a stored schedule is zero, so a malformed rule
    /// cannot make the Agent run on every tick.
    uint256 public constant DEFAULT_SCHEDULE = RuleLib.DEFAULT_SCHEDULE;

    /// @notice The Reactive system contract allowed to call `react()`.
    IReactiveSystem public immutable systemContract;
    /// @notice Registry that stores public listings; the zero address disables publishing.
    IRuleRegistry public immutable registry;
    /// @notice Factory that deployed this agent, recorded for provenance.
    address public immutable factory;
    AgentRulePolicy private immutable _rulePolicy;

    /// @notice Next rule id; rule ids are monotonic and never reused.
    uint256 public nextRuleId;
    /// @notice Number of rules whose active flag is set.
    uint256 public activeRules;
    /// @notice Last time this account observed owner activity, used by the dead-man switch.
    uint64 public lastActivity;
    /// @notice Per-run amounts currently reserved by active rules for this month.
    uint256 public monthlyReserved;
    /// @notice Amount actually spent by fired rules inside the current rolling window.
    uint256 public monthlySpent;
    /// @notice Start of the current accounting window.
    uint64 public monthlyWindowStart;

    mapping(uint256 => RuleLib.Rule) private _rules;
    uint256[] private _order;
    uint256[] private _activeOrder;
    mapping(uint256 => uint256) private _position;
    mapping(uint256 => uint256) private _nextDue;
    mapping(uint256 => bytes32) private _lastDipObservation;
    mapping(bytes32 => uint256) private _latestCronBlock;
    mapping(uint256 => address) private _vaults;
    mapping(address => uint256) private _cachedPrice;
    mapping(address => uint64) private _cachedPriceAt;
    mapping(address => uint256) private _cachedPriceBlock;
    mapping(address => uint256) private _cachedPriceIndex;
    mapping(address => uint256) private _previousPrice;
    mapping(uint256 => uint256) private _highWater;
    mapping(uint256 => uint256) private _pendingGridPrice;
    mapping(bytes32 => uint256) private _topicRefCount;
    mapping(uint256 => Subscription[3]) private _ruleSubscriptions;
    mapping(uint256 => uint256) public replacementFor;
    mapping(address => uint256) private _observedBalance;
    mapping(address => uint256) private _balanceObservedAt;
    uint256 private _balanceSubscribedAt;
    uint256 private _balanceBlock;
    uint256 private _balanceLogIndex;
    mapping(uint256 => uint64) private _executionNotBefore;
    mapping(uint256 => uint32) private _refundedSequence;
    mapping(uint256 => MirrorConfig) private _mirrors;
    mapping(bytes32 => bool) private _consumedMirrorEvents;
    mapping(bytes32 => bool) private _attachedMirrorSources;
    mapping(bytes32 => MirrorWindow) private _mirrorWindows;
    MirrorWindow private _accountMirrorWindow;

    constructor(address owner_, IReactiveSystem system_, IRuleRegistry registry_, address factory_)
        Ownable(owner_)
    {
        systemContract = system_;
        registry = registry_;
        factory = factory_;
        _rulePolicy = new AgentRulePolicy();
        lastActivity = uint64(block.timestamp);
    }

    /// @notice Initializes a factory clone in the same transaction that deploys it.
    function initialize(address owner_) external {
        if (msg.sender != factory || owner_ == address(0) || owner() != address(0)) {
            revert InvalidTemplateParams();
        }
        _transferOwnership(owner_);
        lastActivity = uint64(block.timestamp);
    }

    function _transferOwnership(address newOwner) internal override {
        // The directory and linked vault bind this instance to its original owner.
        if (owner() != address(0)) revert InvalidTemplateParams();
        super._transferOwnership(newOwner);
    }

    modifier onlyAgentOwner() {
        if (msg.sender != owner()) revert NotOwner();
        lastActivity = uint64(block.timestamp);
        _;
    }

    /// @notice Creates a rule owned by this account.
    /// @dev This is the only path that writes the registry: the owner's own transaction lists
    /// the rule, so the backend indexer never writes it (FR-038, FR-052).
    /// @param rule The complete rule, validated by `RuleLib.validate`.
    /// @param makePublic True when the rule should also be listed in the registry.
    /// @return ruleId The id assigned to the new rule.
    function addRule(RuleLib.Rule calldata rule, bool makePublic)
        external
        onlyAgentOwner
        returns (uint256 ruleId)
    {
        ruleId = _createRule(rule, makePublic, true, _order.length);
    }

    /// @notice Retires a rule and creates its successor in the same priority slot.
    /// @dev A latched or paused rule gets a paused successor. Old callback sequences and
    /// marketplace settings remain associated with the old id.
    function replaceRule(
        uint256 oldId,
        uint8 expectedFlags,
        RuleLib.Rule calldata rule,
        bool makePublic
    ) external onlyAgentOwner returns (uint256 ruleId) {
        RuleLib.Rule storage old = _rules[oldId];
        if (
            oldId >= nextRuleId || _isCancelled(old) || old.flags != expectedFlags
                || (old.flags & RuleLib.FLAG_MIRRORED) != 0
        ) revert RuleNotActive(oldId);
        bool enabled = expectedFlags == RuleLib.FLAG_ACTIVE;
        uint256 due = old.template == rule.template && _schedule(old) == _schedule(rule)
            ? _nextDue[oldId]
            : 0;
        uint64 notBefore = _executionNotBefore[oldId];
        if (!RuleLib.isAlertTemplate(old.template) && old.lastRun != 0) {
            notBefore = old.lastRun + EXECUTION_LIFETIME + 1;
        }
        uint256 position = _position[oldId];
        _cancelRule(oldId);
        _position[oldId] = _order.length;
        ruleId = _createRule(rule, makePublic, enabled, position);
        _order[_order.length - 1] = oldId;
        _order[position] = ruleId;
        _nextDue[ruleId] = Math.max(due, notBefore);
        _executionNotBefore[ruleId] = notBefore;
        replacementFor[oldId] = ruleId;
        emit RuleReplaced(oldId, ruleId);
    }

    function _createRule(
        RuleLib.Rule calldata rule,
        bool makePublic,
        bool enabled,
        uint256 position
    ) private returns (uint256 ruleId) {
        _rulePolicy.validate(rule);
        if (
            (rule.template == 6 || rule.template == 8 || rule.template == 9 || rule.template == 13)
                && _vaults[rule.chainId] == address(0)
        ) {
            revert AgentNotLinked();
        }
        if (RuleLib.isExpiryTemplate(rule.template) && rule.secondary <= block.timestamp) {
            revert InvalidSecondary();
        }
        if (rule.amountIn > MAX_SPEND_PER_RUN) {
            revert ExceedsPerRunCap(rule.amountIn, MAX_SPEND_PER_RUN);
        }
        RuleLib.Rule memory stored = rule;
        stored.flags = 0;
        stored.lastRun = 0;
        stored.runs = 0;

        ruleId = nextRuleId++;
        _rules[ruleId] = stored;
        _position[ruleId] = position;
        _order.push(ruleId);
        if (enabled) _enableRule(ruleId, _rules[ruleId]);
        if (makePublic) {
            if (address(registry) == address(0)) revert RegistryNotConfigured();
            registry.list(address(this), ruleId, "");
        }
        emit RuleCreated(address(this), ruleId, rule.template, makePublic);
        if (enabled) _emitBudgetLowIfLow();
        else emit RulePaused(address(this), ruleId, true);
    }

    /// @notice Pauses an active rule. Pausing the last rule on a topic releases it.
    function pauseRule(uint256 ruleId) external onlyAgentOwner {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (!_isActive(rule)) revert RuleNotActive(ruleId);
        rule.flags &= ~RuleLib.FLAG_ACTIVE;
        activeRules -= 1;
        _removeActive(ruleId);
        _releaseMonthlyBudget(rule.amountIn);
        _releaseSubscriptions(ruleId, _pendingGridPrice[ruleId] != 0);
        emit RulePaused(address(this), ruleId, true);
    }

    /// @notice Resumes a paused rule and re-acquires its subscriptions.
    function resumeRule(uint256 ruleId) external onlyAgentOwner {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (ruleId >= nextRuleId || _isCancelled(rule) || _isActive(rule)) {
            revert RuleNotActive(ruleId);
        }
        _enableRule(ruleId, rule);
        emit RulePaused(address(this), ruleId, false);
        _emitBudgetLowIfLow();
    }

    function _enableRule(uint256 ruleId, RuleLib.Rule storage rule) private {
        if (activeRules >= RuleLib.MAX_ACTIVE_RULES) {
            revert RuleLimitReached(activeRules, RuleLib.MAX_ACTIVE_RULES);
        }
        _reserveMonthlyBudget(rule.amountIn);
        rule.flags |= RuleLib.FLAG_ACTIVE;
        activeRules += 1;
        _insertActive(ruleId);
        _acquireSubscriptions(ruleId, rule);
    }

    /// @notice Cancels a rule permanently and releases its subscriptions.
    function cancelRule(uint256 ruleId) external onlyAgentOwner {
        _cancelRule(ruleId);
    }

    /// @dev Cancels an existing rule and clears an attached mirror.
    function _cancelRule(uint256 ruleId) private {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (ruleId >= nextRuleId || _isCancelled(rule)) revert RuleNotActive(ruleId);
        if (_isActive(rule)) {
            activeRules -= 1;
            _removeActive(ruleId);
            _releaseMonthlyBudget(rule.amountIn);
        }
        _releaseSubscriptions(ruleId, false);
        delete _pendingGridPrice[ruleId];
        MirrorConfig storage mirror = _mirrors[ruleId];
        if (mirror.leaderVault != address(0)) {
            delete _attachedMirrorSources[_mirrorSource(mirror.leaderVault, mirror.leaderRuleId)];
            delete _mirrors[ruleId];
            emit MirrorDetached(ruleId);
        }
        rule.flags = RuleLib.FLAG_CANCELLED;
        emit RulePaused(address(this), ruleId, true);
        emit RuleCancelled(address(this), ruleId);
    }

    /// @notice Clears the latched flag so a fired non-cron rule can fire again.
    function resetRule(uint256 ruleId) external onlyAgentOwner {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (ruleId >= nextRuleId || _isCancelled(rule)) revert RuleNotActive(ruleId);
        if ((rule.flags & RuleLib.FLAG_LATCHED) == 0) return;
        if (!RuleLib.isAlertTemplate(rule.template)) {
            uint64 readyAt = rule.lastRun + EXECUTION_LIFETIME + 1;
            if (block.timestamp < readyAt) revert CooldownActive(ruleId, readyAt);
        }
        if (_pendingGridPrice[ruleId] != 0 && !_isActive(rule)) {
            _releaseSubscriptions(ruleId, false);
        }
        delete _pendingGridPrice[ruleId];
        _setLatch(ruleId, rule, false);
    }

    /// @notice Replaces the evaluation order with a full permutation of the account's rule ids.
    function reorderRules(uint256[] calldata ids) external onlyAgentOwner {
        if (ids.length != _order.length) revert InvalidTemplateParams();
        bool[] memory seen = new bool[](nextRuleId);
        delete _activeOrder;
        for (uint256 i = 0; i < ids.length; ++i) {
            uint256 id = ids[i];
            if (id >= nextRuleId || seen[id]) revert InvalidTemplateParams();
            seen[id] = true;
            _position[id] = i;
            if (_isActive(_rules[id])) _activeOrder.push(id);
        }
        _order = ids;
    }

    /// @notice Reorders only enabled rules, preserving the saved slots of paused rules.
    function reorderEvaluationRules(uint256[] calldata ids, bytes32 expectedOrder)
        external
        onlyAgentOwner
    {
        if (
            ids.length != _activeOrder.length
                || expectedOrder != keccak256(abi.encode(_activeOrder))
        ) {
            revert InvalidTemplateParams();
        }
        uint256[] memory positions = new uint256[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            positions[i] = _position[_activeOrder[i]];
        }
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            if (!_isActive(_rules[id])) revert InvalidTemplateParams();
            for (uint256 j; j < i; ++j) {
                if (ids[j] == id) revert InvalidTemplateParams();
            }
            _position[id] = positions[i];
            _order[positions[i]] = id;
        }
        _activeOrder = ids;
    }

    function _removeActive(uint256 ruleId) private {
        uint256 last = _activeOrder.length - 1;
        uint256 index;
        while (_activeOrder[index] != ruleId) ++index;
        for (; index < last; ++index) {
            _activeOrder[index] = _activeOrder[index + 1];
        }
        _activeOrder.pop();
    }

    function _insertActive(uint256 ruleId) private {
        uint256 index = _activeOrder.length;
        _activeOrder.push(ruleId);
        uint256 position = _position[ruleId];
        while (index > 0 && _position[_activeOrder[index - 1]] > position) {
            _activeOrder[index] = _activeOrder[index - 1];
            --index;
        }
        _activeOrder[index] = ruleId;
    }

    /// @notice Links this account to its funds-side vault on `chainId`.
    /// @dev Owner-authorized metadata only. Cross-chain code cannot be read synchronously.
    /// The VaultFactory independently verifies an owner signature binding this Agent to its Vault.
    function linkVault(uint256 chainId, address vault) external onlyAgentOwner {
        if (!ChainConfig.isSupported(chainId)) {
            revert InvalidTemplateParams();
        }
        if (vault == address(0)) revert InvalidTemplateParams();
        address existing = _vaults[chainId];
        if (existing != address(0) && existing != vault) revert InvalidTemplateParams();
        _vaults[chainId] = vault;
        if (existing == address(0)) {
            for (uint256 i; i < _activeOrder.length; ++i) {
                uint256 id = _activeOrder[i];
                if (_rules[id].chainId == chainId) _acquireSubscriptions(id, _rules[id]);
            }
        }
        emit VaultLinked(chainId, vault);
    }

    /// @notice Creates a private follower rule from another account's swap rule.
    /// @param ruleId The next rule id, as shown in the owner's signature review.
    /// @param config Source and owner-approved limits.
    function addMirror(uint256 ruleId, MirrorConfig calldata config) external onlyAgentOwner {
        if (ruleId != nextRuleId) revert RuleNotActive(ruleId);
        if (activeRules >= RuleLib.MAX_ACTIVE_RULES) {
            revert RuleLimitReached(activeRules, RuleLib.MAX_ACTIVE_RULES);
        }
        if (config.scaleBps == 0 || config.scaleBps > PriceMath.BPS) revert InvalidSecondary();
        if (config.hourlyCap == 0 || config.hourlyCap > MAX_MIRRORS_PER_HOUR) {
            revert InvalidSecondary();
        }
        if (config.perRunCap == 0) revert InvalidAmount();
        if (config.perRunCap > MAX_SPEND_PER_RUN) {
            revert ExceedsPerRunCap(config.perRunCap, MAX_SPEND_PER_RUN);
        }
        RuleLib.Rule memory source = _rulePolicy.validateMirrorSource(
            factory,
            _vaults[config.leaderChainId],
            config.leaderChainId,
            config.leaderAgent,
            config.leaderVault,
            config.leaderRuleId,
            config.tokenIn
        );
        bytes32 sourceKey = _mirrorSource(config.leaderVault, config.leaderRuleId);
        if (_attachedMirrorSources[sourceKey]) revert InvalidTemplateParams();
        _reserveMonthlyBudget(config.perRunCap);

        _attachedMirrorSources[sourceKey] = true;
        _mirrors[ruleId] = config;
        source.flags = RuleLib.FLAG_ACTIVE | RuleLib.FLAG_MIRRORED;
        source.amountIn = config.perRunCap;
        source.lastRun = 0;
        source.runs = 0;
        _rules[ruleId] = source;
        nextRuleId++;
        _position[ruleId] = _order.length;
        _order.push(ruleId);
        _activeOrder.push(ruleId);
        activeRules++;
        lastActivity = uint64(block.timestamp);
        _acquireSubscriptions(ruleId, source);
        emit RuleCreated(address(this), ruleId, source.template, false);
        emit MirrorAttached(
            ruleId,
            config.leaderAgent,
            config.leaderVault,
            config.leaderRuleId,
            config.scaleBps,
            config.perRunCap,
            config.hourlyCap
        );
        _emitBudgetLowIfLow();
    }

    /// @notice Stops the follower rule and releases its subscription and budget.
    function detachMirror(uint256 ruleId) external onlyAgentOwner {
        if (_mirrors[ruleId].leaderVault == address(0)) revert RuleNotActive(ruleId);
        _cancelRule(ruleId);
    }

    /// @notice Reactive entry point. Only the system contract may call it.
    /// @dev Evaluates rules in order, records fired runs, requests a callback for money
    /// templates, raises alerts for alert templates, and keeps the price cache fresh. Rules that
    /// do not fit the remaining gas are deferred, never allowed to revert the whole wake-up
    /// (a revert is charged in full).
    function react(IReactive.LogRecord calldata log) external {
        if (msg.sender != address(systemContract)) revert NotServiceProvider();

        if (log.chain_id == ChainConfig.LASNA && log._contract == ChainConfig.lasna().cronSource) {
            bytes32 topic = bytes32(log.topic_0);
            if (log.topic_1 != log.block_number || log.block_number <= _latestCronBlock[topic]) {
                return;
            }
            _latestCronBlock[topic] = log.block_number;
        }
        if (bytes32(log.topic_0) == GRID_SETTLED_TOPIC) {
            _settleGrid(log);
            return;
        }
        if (bytes32(log.topic_0) == SWAP_FUNDS_TOPIC) {
            _observeSwapFunds(log);
            return;
        }

        bool freshPrice = _observe(log);
        _rollMonthlyWindow();
        uint256 startGas = gasleft();
        uint256 length = _activeOrder.length;
        bool deferring;
        for (uint256 i = 0; i < length; ++i) {
            uint256 ruleId = _activeOrder[i];
            RuleLib.Rule storage rule = _rules[ruleId];
            bool mirror = (rule.flags & RuleLib.FLAG_MIRRORED) != 0;
            if (deferring || _mustDefer(startGas, mirror)) {
                deferring = true;
                emit EvaluationDeferred(ruleId, gasleft());
                continue;
            }
            bool fired = mirror
                ? _reactToMirror(ruleId, rule, log)
                : _evaluatesTrue(ruleId, rule, log, freshPrice);
            if (fired && !mirror) {
                if (_shortOnSwapFunds(rule)) {
                    if (RuleLib.isCronTemplate(rule.template)) _advanceSchedule(ruleId, rule);
                    fired = false;
                } else {
                    _recordExecution(ruleId, rule);
                    if (RuleLib.isAlertTemplate(rule.template)) {
                        emit AlertRaised(ruleId, rule.template, _observedValue(rule, log));
                    } else {
                        _requestCallback(ruleId, rule);
                    }
                }
            }
            emit RuleEvaluated(
                ruleId, log.chain_id, bytes32(log.tx_hash), uint32(log.log_index), fired
            );
        }
    }

    function _settleGrid(IReactive.LogRecord calldata log) private {
        uint256 ruleId = log.topic_1;
        RuleLib.Rule storage rule = _rules[ruleId];
        uint256 price = _pendingGridPrice[ruleId];
        if (
            price == 0 || _isCancelled(rule) || log.chain_id != rule.chainId
                || log._contract != _vaults[rule.chainId] || log.topic_2 != rule.runs
        ) return;
        _highWater[ruleId] = price;
        delete _pendingGridPrice[ruleId];
        _setLatch(ruleId, rule, false);
        if (!_isActive(rule)) _releaseSubscriptions(ruleId, false);
    }

    /// @dev Ignores every event except a matching leader swap and consumes the delivery once.
    function _reactToMirror(
        uint256 ruleId,
        RuleLib.Rule storage rule,
        IReactive.LogRecord calldata log
    ) private returns (bool) {
        if (!_isActive(rule) || bytes32(log.topic_0) != EXECUTED_TOPIC) {
            return false;
        }
        MirrorConfig storage config = _mirrors[ruleId];
        if (
            log.chain_id != config.leaderChainId || log._contract != config.leaderVault
                || log.topic_1 != config.leaderRuleId || log.data.length != 160 || log.tx_hash == 0
        ) return false;
        (uint256 tokenIn, uint256 tokenOut, uint256 leaderIn, uint256 leaderOut,) =
            abi.decode(log.data, (uint256, uint256, uint256, uint256, uint256));
        if (
            tokenIn != uint160(rule.tokenIn) || tokenOut != uint160(rule.tokenOut) || leaderIn == 0
                || leaderOut == 0
        ) {
            return false;
        }

        bytes32 leaderTx = bytes32(log.tx_hash);
        bytes32 key = CallbackPayload.mirrorExecutionKey(log._contract, log.topic_1, leaderTx);
        if (_consumedMirrorEvents[key]) return false;
        _consumedMirrorEvents[key] = true;

        uint256 amount = Math.mulDiv(leaderIn, config.scaleBps, PriceMath.BPS);
        if (amount > config.perRunCap) amount = config.perRunCap;
        uint256 floor = Math.mulDiv(
            Math.mulDiv(leaderOut, amount, leaderIn),
            PriceMath.BPS - DECISION_SLIPPAGE_BPS,
            PriceMath.BPS
        );
        if (
            floor == 0 || monthlySpent >= MONTHLY_SPEND_CAP
                || amount > MONTHLY_SPEND_CAP - monthlySpent
        ) return false;
        MirrorWindow storage window = _mirrorWindows[_mirrorSource(log._contract, log.topic_1)];
        if (
            !_hasMirrorCapacity(window, config.hourlyCap)
                || !_hasMirrorCapacity(_accountMirrorWindow, MAX_MIRRORS_PER_HOUR)
        ) return false;
        _recordMirrorAttempt(window);
        _recordMirrorAttempt(_accountMirrorWindow);
        rule.lastRun = uint64(block.timestamp);
        rule.runs++;
        monthlySpent += amount;

        _requestMirrorCallback(ruleId, rule, log, amount, floor);
        emit MirrorCallbackRequested(leaderTx, log._contract, ruleId);
        return true;
    }

    /// @dev Uses a rolling hour so two bursts cannot straddle a fixed-window boundary.
    function _hasMirrorCapacity(MirrorWindow storage window, uint8 cap)
        private
        view
        returns (bool)
    {
        uint256 index = (uint256(window.next) + MAX_MIRRORS_PER_HOUR - cap) % MAX_MIRRORS_PER_HOUR;
        uint64 oldest = window.timestamps[index];
        return oldest == 0 || block.timestamp >= uint256(oldest) + 1 hours;
    }

    /// @dev Pushes one attempt onto the rolling window's fixed-size ring.
    function _recordMirrorAttempt(MirrorWindow storage window) private {
        window.timestamps[window.next] = uint64(block.timestamp);
        window.next = (window.next + 1) % MAX_MIRRORS_PER_HOUR;
    }

    /// @dev Keeps a source's rolling limit across detachment and reattachment.
    function _mirrorSource(address vault, uint256 ruleId) private pure returns (bytes32) {
        return keccak256(abi.encode(vault, ruleId));
    }

    /// @dev Routes the swap directly to the follower's linked destination contract.
    function _requestMirrorCallback(
        uint256 ruleId,
        RuleLib.Rule storage rule,
        IReactive.LogRecord calldata log,
        uint256 amount,
        uint256 floor
    ) private {
        MirrorPayload memory payload = MirrorPayload(
            rule.pair,
            rule.tokenIn,
            rule.tokenOut,
            amount,
            floor,
            log._contract,
            bytes32(log.tx_hash),
            log.topic_1
        );
        systemContract.requestCallbackV_1_0(
            CallbackConfiguration(
                rule.chainId,
                _vaults[rule.chainId],
                MIRROR_CALLBACK_GAS,
                CallbackPayload.encodeMirror(ruleId, payload)
            )
        );
    }

    /// @notice Returns one rule by id.
    function getRule(uint256 ruleId) external view returns (RuleLib.Rule memory rule) {
        rule = _rules[ruleId];
    }

    /// @notice Legacy order including historical rule ids.
    function getRuleIds() external view returns (uint256[] memory ids) {
        ids = _order;
    }

    /// @notice Returns exactly the ordered ids considered by the evaluator.
    function getEvaluationOrder() external view returns (uint256[] memory) {
        return _activeOrder;
    }

    /// @notice Returns the vault linked for `chainId`, or the zero address.
    function getVault(uint256 chainId) external view returns (address vault) {
        vault = _vaults[chainId];
    }

    /// @notice Returns the last traded price for `pair` and when it was observed.
    function getCachedPrice(address pair) external view returns (uint256 price, uint64 observedAt) {
        price = _cachedPrice[pair];
        observedAt = _cachedPriceAt[pair];
    }

    /// @notice Returns the observation before `pair`'s latest one, used by dip-boost DCA.
    function previousPriceOf(address pair) external view returns (uint256 price) {
        price = _previousPrice[pair];
    }

    /// @notice Number of active rules, mirroring `activeRules` for interface symmetry.
    function activeRuleCount() external view returns (uint256 count) {
        count = activeRules;
    }

    /// @notice Monthly pre-approved spend still available to active rules.
    function remainingMonthlyBudget() external view returns (uint256 remaining) {
        remaining = monthlyReserved >= MONTHLY_SPEND_CAP ? 0 : MONTHLY_SPEND_CAP - monthlyReserved;
    }

    /// @notice True when the account is close enough to silence to warn its owner.
    function budgetIsLow() external view returns (bool low) {
        low = MONTHLY_SPEND_CAP - monthlyReserved <= BUDGET_LOW_THRESHOLD;
    }

    /// @notice Returns the mirror configuration attached to `ruleId`.
    function getMirror(uint256 ruleId) external view returns (MirrorConfig memory mirror) {
        mirror = _mirrors[ruleId];
    }

    /// @notice Returns the trailing-stop / grid reference recorded for `ruleId`.
    function getHighWater(uint256 ruleId) external view returns (uint256 referencePrice) {
        referencePrice = _highWater[ruleId];
    }

    /// @notice Returns the subscriptions a rule currently holds, for off-chain introspection.
    function getSubscriptions(uint256 ruleId) external view returns (Subscription[3] memory subs) {
        subs = _ruleSubscriptions[ruleId];
    }

    /// @dev Decides whether a rule's condition holds for this observation. One branch per
    /// template, all fed by the same cache and the same `LogRecord` (US5).
    function _evaluatesTrue(
        uint256 ruleId,
        RuleLib.Rule storage rule,
        IReactive.LogRecord calldata log,
        bool freshPrice
    ) private returns (bool) {
        if (
            !_isActive(rule) || (rule.flags & RuleLib.FLAG_LATCHED) != 0
                || block.timestamp < _nextDue[ruleId]
        ) {
            return false;
        }
        uint8 template = rule.template;
        if (!RuleLib.isAlertTemplate(template) && _vaults[rule.chainId] == address(0)) {
            return false;
        }
        if (rule.amountIn > MONTHLY_SPEND_CAP - monthlySpent) return false;

        if (RuleLib.isCronTemplate(template)) {
            if (!_isCronTick(rule, log)) return false;
            if (template == 1 || template == 7) return true;
            if (template == 2) return _dipped(ruleId, rule);
            return _inactivityReached(rule);
        }

        if (log.chain_id != rule.chainId) return false;
        if (template == 8 || template == 13) return _incomingTransferHits(rule, log);
        if (template == 9) return _balanceBelowFloor(rule, log);

        if (!freshPrice || log._contract != rule.pair) return false;
        uint256 price = _cachedPrice[rule.pair];
        if (price == 0) return false;

        if (template == 3) return block.timestamp <= rule.secondary && price <= rule.threshold;
        if (template == 4) return block.timestamp <= rule.secondary && price >= rule.threshold;
        if (template == 5) return _stopLossHit(ruleId, rule, price);
        if (template == 6) return _gridMoved(ruleId, rule, price);
        if (template == 11) return price >= rule.threshold;
        // Template 12: the price left the range `threshold` (low) .. `secondary` (high).
        return price < rule.threshold || price > rule.secondary;
    }

    /// @dev Dip boost: the last traded price is at least `secondary` below the prior observation.
    function _dipped(uint256 ruleId, RuleLib.Rule storage rule) private view returns (bool) {
        uint256 previous = _previousPrice[rule.pair];
        uint256 price = _cachedPrice[rule.pair];
        if (previous == 0 || price == 0) return false;
        if (_lastDipObservation[ruleId] == _observationKey(rule.pair)) return false;
        if (block.timestamp - _cachedPriceAt[rule.pair] > _schedule(rule)) return false;
        return price * 10_000 <= previous * (10_000 - rule.secondary);
    }

    function _observationKey(address pair) private view returns (bytes32) {
        return keccak256(abi.encode(_cachedPriceBlock[pair], _cachedPriceIndex[pair]));
    }

    /// @dev Stop loss, optionally trailing `secondary` bps below the highest observed price.
    function _stopLossHit(uint256 ruleId, RuleLib.Rule storage rule, uint256 price)
        private
        returns (bool)
    {
        uint256 high = _highWater[ruleId];
        if (price > high) {
            high = price;
            _highWater[ruleId] = high;
        }
        uint256 stop = rule.threshold;
        if (rule.secondary != 0) {
            uint256 trailing = (high * (10_000 - rule.secondary)) / 10_000;
            if (trailing > stop) stop = trailing;
        }
        return price <= stop;
    }

    /// @dev Grid rebalance: the price moved `secondary` bps away from its reference; a fill
    /// moves the reference to the observed price.
    function _gridMoved(uint256 ruleId, RuleLib.Rule storage rule, uint256 price)
        private
        view
        returns (bool)
    {
        uint256 referencePrice = _highWater[ruleId];
        if (referencePrice == 0) referencePrice = rule.threshold;
        return PriceMath.movedBy(price, referencePrice, rule.secondary);
    }

    /// @dev Dead-man switch: no owner activity for `secondary` days.
    function _inactivityReached(RuleLib.Rule storage rule) private view returns (bool) {
        return block.timestamp >= uint256(lastActivity) + uint256(rule.secondary) * 1 days;
    }

    /// @dev Income sweep (8) and large-transfer alert (13): an incoming transfer to the vault.
    function _incomingTransferHits(RuleLib.Rule storage rule, IReactive.LogRecord calldata log)
        private
        view
        returns (bool)
    {
        if (bytes32(log.topic_0) != TRANSFER_TOPIC) return false;
        if (log._contract != rule.tokenIn) return false;
        address vault = _vaults[rule.chainId];
        if (vault == address(0) || address(uint160(log.topic_2)) != vault) return false;
        if (log.data.length < 32) return false;
        uint256 amount = abi.decode(log.data, (uint256));
        return rule.template == 8 ? amount >= rule.threshold : amount > rule.threshold;
    }

    /// @dev Balance floor (9): the Vault's own `Balances` event reports the token below the floor.
    function _balanceBelowFloor(RuleLib.Rule storage rule, IReactive.LogRecord calldata log)
        private
        view
        returns (bool)
    {
        if (bytes32(log.topic_0) != BALANCES_TOPIC) return false;
        if (log._contract != _vaults[rule.chainId]) return false;
        if (log.data.length < 128) return false;
        (address token0, uint256 balance0, address token1, uint256 balance1) =
            abi.decode(log.data, (address, uint256, address, uint256));
        if (token0 == rule.tokenIn) return balance0 < rule.threshold;
        return token1 == rule.tokenIn && balance1 < rule.threshold;
    }

    /// @dev The value an alert reports: the observed price or the observed transfer amount.
    function _observedValue(RuleLib.Rule storage rule, IReactive.LogRecord calldata log)
        private
        view
        returns (uint256)
    {
        if (rule.template == 13 && log.data.length >= 32) {
            return abi.decode(log.data, (uint256));
        }
        return _cachedPrice[rule.pair];
    }

    /// @dev Scheduled rules subscribe on Lasna, independently of their callback destination.
    function _isCronTick(RuleLib.Rule memory rule, IReactive.LogRecord calldata log)
        private
        pure
        returns (bool)
    {
        return log.chain_id == ChainConfig.LASNA && bytes32(log.topic_0) == _cronTopic(rule)
            && log._contract == ChainConfig.lasna().cronSource && log.topic_1 == log.block_number;
    }

    function _cronTopic(RuleLib.Rule memory rule) private pure returns (bytes32) {
        return _schedule(rule) < 1 days ? HOURLY_CRON_TOPIC : DAILY_CRON_TOPIC;
    }

    function _schedule(RuleLib.Rule memory rule) private pure returns (uint256) {
        return RuleLib.schedule(rule);
    }

    /// @dev Requests a callback to the linked vault through Reactive's proxy.
    function _requestCallback(uint256 ruleId, RuleLib.Rule storage rule) private {
        uint8 template = rule.template;
        bool swapping = RuleLib.isSwapTemplate(template);
        uint256 threshold = rule.threshold;
        uint256 extra = swapping ? 0 : uint256(uint160(rule.pair));
        uint64 expiry = uint64(block.timestamp) + EXECUTION_LIFETIME;
        if (RuleLib.isExpiryTemplate(template) && rule.secondary < expiry) {
            expiry = uint64(rule.secondary);
        }
        if (template == 2) {
            threshold = PriceMath.applySlippage(_previousPrice[rule.pair], rule.secondary);
            _lastDipObservation[ruleId] = _observationKey(rule.pair);
        } else if (template == 5 && rule.secondary != 0) {
            threshold =
                Math.max(threshold, PriceMath.applySlippage(_highWater[ruleId], rule.secondary));
        } else if (template == 6) {
            if (_highWater[ruleId] != 0) threshold = _highWater[ruleId];
            _pendingGridPrice[ruleId] = _cachedPrice[rule.pair];
            extra = rule.secondary;
        }

        ExecutionPayload memory payload = ExecutionPayload({
            template: template,
            pair: rule.pair,
            threshold: threshold,
            amountIn: rule.amountIn,
            expiry: expiry,
            extra: extra | (uint256(_executionNotBefore[ruleId]) << 160),
            tokenIn: rule.tokenIn,
            tokenOut: rule.tokenOut,
            sequence: rule.runs
        });

        systemContract.requestCallbackV_1_0(
            CallbackConfiguration({
                chainId: rule.chainId,
                recipient: _vaults[rule.chainId],
                gasLimit: swapping ? SWAP_CALLBACK_GAS : TRANSFER_CALLBACK_GAS,
                payload: CallbackPayload.encode(ruleId, payload)
            })
        );
    }

    /// @dev True when this wake-up must stop evaluating and defer the rest (T151).
    function _mustDefer(uint256 startGas, bool mirror) private view returns (bool) {
        uint256 floor = (mirror ? MIRROR_GAS_ESTIMATE : EVALUATION_GAS_ESTIMATE) + REACT_GAS_RESERVE;
        if (gasleft() < floor) return true;
        return startGas - gasleft() + floor > MAX_REACT_GAS;
    }

    /// @dev Per-rule execution counter and the origin-side budget ledger (T156).
    function _recordExecution(uint256 ruleId, RuleLib.Rule storage rule) private {
        rule.runs += 1;
        rule.lastRun = uint64(block.timestamp);
        if (RuleLib.isCronTemplate(rule.template)) {
            _advanceSchedule(ruleId, rule);
        } else {
            _setLatch(ruleId, rule, true);
        }
        monthlySpent += rule.amountIn;
    }

    function _advanceSchedule(uint256 ruleId, RuleLib.Rule storage rule) private {
        uint256 schedule = _schedule(rule);
        uint256 due = _nextDue[ruleId];
        if (due == 0) due = block.timestamp;
        _nextDue[ruleId] = due + ((block.timestamp - due) / schedule + 1) * schedule;
    }

    function _shortOnSwapFunds(RuleLib.Rule storage rule) private view returns (bool) {
        if (rule.template > 2) return false;
        uint256 observedAt = _balanceObservedAt[rule.tokenIn];
        return observedAt != 0 && observedAt >= _balanceSubscribedAt
            && block.timestamp - observedAt < FUNDING_OBSERVATION_LIFETIME
            && _observedBalance[rule.tokenIn] < rule.amountIn;
    }

    function _observeSwapFunds(IReactive.LogRecord calldata log) private {
        if (
            log.chain_id != ChainConfig.UNICHAIN_SEPOLIA || log._contract != _vaults[log.chain_id]
                || log._contract == address(0) || log.data.length != 160
        ) return;
        (address token, uint256 balance, uint256 observedAt, uint256 skippedId, uint32 sequence) =
            abi.decode(log.data, (address, uint256, uint256, uint256, uint32));
        if (sequence != 0) {
            RuleLib.Rule storage rule = _rules[skippedId];
            if (
                rule.runs == sequence && _refundedSequence[skippedId] < sequence
                    && rule.lastRun >= monthlyWindowStart && monthlySpent >= rule.amountIn
                    && rule.tokenIn == token && rule.template <= 2
            ) {
                _refundedSequence[skippedId] = sequence;
                monthlySpent -= rule.amountIn;
            }
        }
        if (
            observedAt < _balanceSubscribedAt || log.block_number < _balanceBlock
                || (log.block_number == _balanceBlock && log.log_index <= _balanceLogIndex)
        ) return;
        _balanceBlock = log.block_number;
        _balanceLogIndex = log.log_index;
        _observedBalance[token] = balance;
        _balanceObservedAt[token] = Math.min(observedAt, block.timestamp);
    }

    function _setLatch(uint256 ruleId, RuleLib.Rule storage rule, bool latched) private {
        if (latched) rule.flags |= RuleLib.FLAG_LATCHED;
        else rule.flags &= ~RuleLib.FLAG_LATCHED;
        emit RuleLatchChanged(ruleId, latched);
    }

    /// @dev Reserves a rule's per-run amount against the monthly cap, or reverts with its own
    /// error so the UI can name the limit rather than blaming the per-run ceiling.
    function _reserveMonthlyBudget(uint256 amountIn) private {
        _rollMonthlyWindow();
        uint256 approved = monthlyReserved + amountIn;
        if (approved > MONTHLY_SPEND_CAP) {
            revert MonthlyCapExceeded(approved, MONTHLY_SPEND_CAP);
        }
        monthlyReserved = approved;
    }

    /// @dev Releases a paused or cancelled rule's reservation; never underflows.
    function _releaseMonthlyBudget(uint256 amountIn) private {
        uint256 reserved = monthlyReserved;
        monthlyReserved = amountIn >= reserved ? 0 : reserved - amountIn;
    }

    /// @dev Emits the warning before the account has no headroom left to run a rule.
    function _emitBudgetLowIfLow() private {
        uint256 remaining =
            monthlyReserved >= MONTHLY_SPEND_CAP ? 0 : MONTHLY_SPEND_CAP - monthlyReserved;
        if (remaining <= BUDGET_LOW_THRESHOLD) emit BudgetLow(remaining, BUDGET_LOW_THRESHOLD);
    }

    /// @dev Starts a fresh accounting window after 30 days without losing reservations.
    function _rollMonthlyWindow() private {
        uint64 start = monthlyWindowStart;
        if (start == 0) {
            monthlyWindowStart = uint64(block.timestamp);
            return;
        }
        if (block.timestamp >= uint256(start) + MONTHLY_WINDOW) {
            monthlyWindowStart = uint64(block.timestamp);
            monthlySpent = 0;
        }
    }

    /// @dev Refreshes the per-pair price cache from a `Sync` observation, and moves the
    /// dead-man clock forward when the owner's own wallet moves tokens.
    /// @dev Only a strictly newer `Sync` may replace the cache; an older observation (a replay or
    /// a reorg) is ignored, and a quiet pair keeps its last value rather than zeroing (T168).
    function _observe(IReactive.LogRecord calldata log) private returns (bool) {
        if (log.chain_id != ChainConfig.UNICHAIN_SEPOLIA) return false;
        bytes32 topic0 = bytes32(log.topic_0);
        if (topic0 == TRANSFER_TOPIC && address(uint160(log.topic_1)) == owner()) {
            lastActivity = uint64(block.timestamp);
        }
        if (topic0 != SYNC_TOPIC || log.data.length != 64) return false;
        uint256 cached = _cachedPrice[log._contract];
        uint256 observedBlock = _cachedPriceBlock[log._contract];
        if (
            cached != 0
                && (log.block_number < observedBlock
                    || (log.block_number == observedBlock
                        && log.log_index <= _cachedPriceIndex[log._contract]))
        ) return false;

        (uint256 reserve0, uint256 reserve1) = abi.decode(log.data, (uint256, uint256));
        if (
            reserve0 == 0 || reserve1 == 0 || reserve0 > type(uint112).max
                || reserve1 > type(uint112).max
        ) {
            return false;
        }
        uint256 price = PriceMath.usdcPerWeth(uint112(reserve0), uint112(reserve1));
        if (price == 0) return false;
        if (cached != 0) _previousPrice[log._contract] = cached;
        _cachedPrice[log._contract] = price;
        _cachedPriceAt[log._contract] = uint64(block.timestamp);
        _cachedPriceBlock[log._contract] = log.block_number;
        _cachedPriceIndex[log._contract] = log.log_index;
        return true;
    }

    /// @dev Subscribes on the first reference to a topic key and increments its count.
    function _acquireSubscriptions(uint256 ruleId, RuleLib.Rule memory rule) private {
        MirrorConfig storage mirror = _mirrors[ruleId];
        Subscription[3] memory subs;
        if (mirror.leaderVault == address(0)) {
            subs = _rulePolicy.subscriptionsFor(ruleId, rule, _vaults[rule.chainId], owner());
        } else {
            subs[0] = Subscription({
                key: _mirrorSource(mirror.leaderVault, mirror.leaderRuleId),
                chainId: mirror.leaderChainId,
                source: mirror.leaderVault,
                topic0: uint256(EXECUTED_TOPIC),
                topic1: mirror.leaderRuleId,
                topic2: ANY_TOPIC
            });
        }
        for (uint256 i = 0; i < subs.length; ++i) {
            bytes32 key = subs[i].key;
            if (key == bytes32(0)) continue;
            if (_ruleSubscriptions[ruleId][i].key == key) continue;
            if (_topicRefCount[key] == 0) {
                _changeSubscription(subs[i], true);
                if (subs[i].topic0 == uint256(SWAP_FUNDS_TOPIC)) {
                    _balanceSubscribedAt = block.timestamp;
                }
            }
            _topicRefCount[key] += 1;
            _ruleSubscriptions[ruleId][i] = subs[i];
        }
    }

    /// @dev Decrements each topic count and unsubscribes when the last reference is released.
    function _releaseSubscriptions(uint256 ruleId, bool keepPendingGridSettlement) private {
        for (uint256 i = 0; i < _ruleSubscriptions[ruleId].length; ++i) {
            Subscription memory sub = _ruleSubscriptions[ruleId][i];
            if (sub.key == bytes32(0)) continue;
            if (keepPendingGridSettlement && sub.topic0 == uint256(GRID_SETTLED_TOPIC)) continue;
            uint256 count = _topicRefCount[sub.key];
            if (count <= 1) {
                _topicRefCount[sub.key] = 0;
                _changeSubscription(sub, false);
            } else {
                _topicRefCount[sub.key] = count - 1;
            }
            delete _ruleSubscriptions[ruleId][i];
        }
    }

    /// @dev The criteria must match byte-for-byte when unsubscribing.
    function _changeSubscription(Subscription memory sub, bool add) private {
        if (add) {
            systemContract.subscribe(
                sub.chainId, sub.source, sub.topic0, sub.topic1, sub.topic2, ANY_TOPIC
            );
        } else {
            systemContract.unsubscribe(
                sub.chainId, sub.source, sub.topic0, sub.topic1, sub.topic2, ANY_TOPIC
            );
        }
    }

    function _isActive(RuleLib.Rule storage rule) private view returns (bool) {
        return (rule.flags & RuleLib.FLAG_ACTIVE) != 0;
    }

    function _isCancelled(RuleLib.Rule storage rule) private view returns (bool) {
        return (rule.flags & RuleLib.FLAG_CANCELLED) != 0;
    }
}

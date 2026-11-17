// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

import {ChainConfig} from "../chain/ChainConfig.sol";
import {PriceMath} from "../libraries/PriceMath.sol";
import {RuleLib} from "../libraries/RuleLib.sol";
import {IReactiveSystem} from "../shared/ReactiveTypes.sol";
import {
    ExceedsPerRunCap,
    InvalidSecondary,
    InvalidTemplateParams,
    MonthlyCapExceeded,
    NotOwner,
    NotServiceProvider,
    RuleLimitReached,
    RuleNotActive
} from "../shared/Errors.sol";

/// @title Agent
/// @notice One user's automation account on Reactive Lasna: rule storage, evaluation order,
/// the per-pair price cache, and the `react()` entry point.
/// @dev `react()` never moves funds and never changes subscriptions; it only decides and requests.
contract Agent is Ownable {
    /// @notice A mirror attachment for a leader execution.
    struct MirrorConfig {
        uint256 leaderChainId;
        address leaderVault;
        uint256 leaderRuleId;
        uint16 scaleBps;
        uint256 perRunCap;
        uint8 hourlyCap;
    }

    /// @notice Emitted for every rule the owner creates.
    event RuleCreated(
        address indexed agent, uint256 indexed ruleId, uint8 template, bool publicRule
    );
    /// @notice Emitted when a rule is paused (`true`) or resumed (`false`).
    event RulePaused(address indexed agent, uint256 indexed ruleId, bool paused);
    /// @notice Emitted when a rule is cancelled.
    event RuleCancelled(address indexed agent, uint256 indexed ruleId);
    /// @notice Emitted for every rule evaluated by `react()`, fired or not.
    event RuleEvaluated(
        uint256 indexed ruleId,
        uint256 indexed originChainId,
        bytes32 originTxHash,
        uint32 originLogIndex,
        bool fired
    );
    /// @notice Emitted when the gas guard defers rules to the next wake-up.
    event EvaluationDeferred(uint256 indexed ruleId, uint256 gasRemaining);
    /// @notice Emitted when an account's execution credit falls below the warning threshold.
    event BudgetLow(uint256 reserved, uint256 threshold);
    /// @notice Emitted when the owner links a funds-side vault.
    event VaultLinked(uint256 indexed chainId, address indexed vault);

    /// @notice Topic0 of a Uniswap V2 pair's `Sync` event.
    bytes32 internal constant SYNC_TOPIC = keccak256("Sync(uint112,uint112)");

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
    uint256 public constant EVALUATION_GAS_ESTIMATE = 45_000;
    /// @notice Rolling accounting window for the per-user monthly execution cap.
    uint64 public constant MONTHLY_WINDOW = 30 days;

    /// @notice The Reactive system contract allowed to call `react()`.
    IReactiveSystem public immutable systemContract;
    /// @notice Factory that deployed this agent, recorded for provenance.
    address public immutable factory;

    /// @notice Next rule id; rule ids are monotonic and never reused.
    uint256 public nextRuleId;
    /// @notice Number of rules whose active flag is set.
    uint256 public activeRules;
    /// @notice Last time this account observed activity, used by the dead-man switch.
    uint64 public lastActivity;
    /// @notice Per-run amounts currently reserved by active rules for this month.
    uint256 public monthlyReserved;
    /// @notice Amount actually spent by fired rules inside the current rolling window.
    uint256 public monthlySpent;
    /// @notice Start of the current accounting window.
    uint64 public monthlyWindowStart;

    mapping(uint256 => RuleLib.Rule) private _rules;
    uint256[] private _order;
    mapping(uint256 => address) private _vaults;
    mapping(address => uint256) private _cachedPrice;
    mapping(address => uint64) private _cachedPriceAt;
    mapping(uint256 => uint256) private _highWater;
    mapping(bytes32 => uint256) private _topicRefCount;
    mapping(uint256 => bytes32) private _ruleTopic;
    mapping(uint256 => MirrorConfig) private _mirrors;

    constructor(address owner_, IReactiveSystem system_, address factory_) Ownable(owner_) {
        systemContract = system_;
        factory = factory_;
    }

    modifier onlyAgentOwner() {
        if (msg.sender != owner()) revert NotOwner();
        _;
    }

    /// @notice Creates a rule owned by this account.
    /// @param rule The complete rule, validated by `RuleLib.validate`.
    /// @param makePublic True when the rule should also be listed in the registry.
    /// @return ruleId The id assigned to the new rule.
    function addRule(RuleLib.Rule calldata rule, bool makePublic)
        external
        onlyAgentOwner
        returns (uint256 ruleId)
    {
        if (activeRules >= RuleLib.MAX_ACTIVE_RULES) {
            revert RuleLimitReached(activeRules, RuleLib.MAX_ACTIVE_RULES);
        }
        RuleLib.validate(rule);
        if (rule.amountIn > MAX_SPEND_PER_RUN) {
            revert ExceedsPerRunCap(rule.amountIn, MAX_SPEND_PER_RUN);
        }
        _reserveMonthlyBudget(rule.amountIn);

        RuleLib.Rule memory stored = rule;
        stored.flags = RuleLib.FLAG_ACTIVE;
        stored.lastRun = 0;
        stored.runs = 0;

        ruleId = nextRuleId++;
        _rules[ruleId] = stored;
        _order.push(ruleId);
        activeRules += 1;

        _acquireSubscription(ruleId, stored);
        emit RuleCreated(address(this), ruleId, rule.template, makePublic);
        _emitBudgetLowIfLow();
    }

    /// @notice Pauses an active rule. Pausing the last rule on a topic releases it.
    function pauseRule(uint256 ruleId) external onlyAgentOwner {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (!_isActive(rule)) revert RuleNotActive(ruleId);
        rule.flags &= ~RuleLib.FLAG_ACTIVE;
        activeRules -= 1;
        _releaseMonthlyBudget(rule.amountIn);
        _releaseSubscription(ruleId);
        emit RulePaused(address(this), ruleId, true);
    }

    /// @notice Resumes a paused rule and re-acquires its subscription.
    function resumeRule(uint256 ruleId) external onlyAgentOwner {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (_isCancelled(rule) || _isActive(rule)) revert RuleNotActive(ruleId);
        _reserveMonthlyBudget(rule.amountIn);
        rule.flags |= RuleLib.FLAG_ACTIVE;
        activeRules += 1;
        _acquireSubscription(ruleId, rule);
        emit RulePaused(address(this), ruleId, false);
        _emitBudgetLowIfLow();
    }

    /// @notice Cancels a rule permanently and releases its subscription references.
    function cancelRule(uint256 ruleId) external onlyAgentOwner {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (_isCancelled(rule)) revert RuleNotActive(ruleId);
        if (_isActive(rule)) {
            activeRules -= 1;
            _releaseMonthlyBudget(rule.amountIn);
        }
        _releaseSubscription(ruleId);
        rule.flags = RuleLib.FLAG_CANCELLED;
        emit RulePaused(address(this), ruleId, true);
        emit RuleCancelled(address(this), ruleId);
    }

    /// @notice Clears the latched flag so a fired non-cron rule can fire again.
    function resetRule(uint256 ruleId) external onlyAgentOwner {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (_isCancelled(rule)) revert RuleNotActive(ruleId);
        rule.flags &= ~RuleLib.FLAG_LATCHED;
    }

    /// @notice Replaces the evaluation order with a full permutation of the account's rule ids.
    function reorderRules(uint256[] calldata ids) external onlyAgentOwner {
        if (ids.length != _order.length) revert InvalidTemplateParams();
        bool[] memory seen = new bool[](nextRuleId);
        for (uint256 i = 0; i < ids.length; ++i) {
            uint256 id = ids[i];
            if (id >= nextRuleId || seen[id]) revert InvalidTemplateParams();
            seen[id] = true;
        }
        _order = ids;
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
        emit VaultLinked(chainId, vault);
    }

    /// @notice Records a mirror attachment for `ruleId`.
    function addMirror(uint256 ruleId, MirrorConfig calldata config) external onlyAgentOwner {
        if (ruleId >= nextRuleId) revert RuleNotActive(ruleId);
        if (!ChainConfig.isSupported(config.leaderChainId)) {
            revert InvalidTemplateParams();
        }
        if (config.leaderVault == address(0)) revert InvalidTemplateParams();
        if (config.scaleBps == 0 || config.scaleBps > 10_000) revert InvalidSecondary();
        if (config.hourlyCap < 1 || config.hourlyCap > 10) revert InvalidSecondary();
        _mirrors[ruleId] = config;
    }

    /// @notice Reactive entry point. Only the system contract may call it.
    /// @dev Evaluates rules in order, records fired runs, and publishes the origin log for the
    /// proof page. Rules that do not fit the remaining gas are deferred, never allowed to revert
    /// the whole wake-up (a revert is charged in full).
    function react(IReactive.LogRecord calldata log) external {
        if (msg.sender != address(systemContract)) revert NotServiceProvider();

        _observe(log);
        _rollMonthlyWindow();
        uint256 startGas = gasleft();
        uint256 length = _order.length;
        bool deferring;
        for (uint256 i = 0; i < length; ++i) {
            uint256 ruleId = _order[i];
            if (deferring || _mustDefer(startGas)) {
                deferring = true;
                emit EvaluationDeferred(ruleId, gasleft());
                continue;
            }
            RuleLib.Rule storage rule = _rules[ruleId];
            bool fired = _evaluatesTrue(rule, log);
            if (fired) _recordExecution(rule);
            emit RuleEvaluated(
                ruleId, log.chain_id, bytes32(log.tx_hash), uint32(log.log_index), fired
            );
        }
    }

    /// @notice Returns one rule by id.
    function getRule(uint256 ruleId) external view returns (RuleLib.Rule memory rule) {
        rule = _rules[ruleId];
    }

    /// @notice Returns every rule id in evaluation order.
    function getRuleIds() external view returns (uint256[] memory ids) {
        ids = _order;
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

    /// @dev Decides whether a rule's condition holds for this observation. Phase 5 needs a
    /// truthful `fired` flag for the proof event; the remaining templates join this decision
    /// point as they land, so the event shape never changes.
    function _evaluatesTrue(RuleLib.Rule storage rule, IReactive.LogRecord calldata log)
        private
        view
        returns (bool)
    {
        if (!_isActive(rule) || (rule.flags & RuleLib.FLAG_LATCHED) != 0) return false;
        if (rule.template != 11) return false;
        if (bytes32(log.topic_0) != SYNC_TOPIC || log._contract != rule.pair) return false;
        uint256 price = _cachedPrice[rule.pair];
        return price != 0 && price >= rule.threshold;
    }

    /// @dev True when this wake-up must stop evaluating and defer the rest (T151).
    function _mustDefer(uint256 startGas) private view returns (bool) {
        uint256 floor = EVALUATION_GAS_ESTIMATE + REACT_GAS_RESERVE;
        if (gasleft() < floor) return true;
        return startGas - gasleft() + floor > MAX_REACT_GAS;
    }

    /// @dev Per-rule execution counter and the origin-side budget ledger (T156).
    function _recordExecution(RuleLib.Rule storage rule) private {
        rule.runs += 1;
        rule.lastRun = uint64(block.timestamp);
        if (!RuleLib.isCronTemplate(rule.template)) rule.flags |= RuleLib.FLAG_LATCHED;
        monthlySpent += rule.amountIn;
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

    /// @dev Refreshes the per-pair price cache from a `Sync` observation.
    function _observe(IReactive.LogRecord calldata log) private {
        if (bytes32(log.topic_0) != SYNC_TOPIC) return;
        (uint112 reserve0, uint112 reserve1) = abi.decode(log.data, (uint112, uint112));
        _cachedPrice[log._contract] = PriceMath.priceFromReserves(reserve0, reserve1);
        _cachedPriceAt[log._contract] = uint64(block.timestamp);
    }

    /// @dev Subscribes on the first reference to a topic and increments its count.
    function _acquireSubscription(uint256 ruleId, RuleLib.Rule memory rule) private {
        bytes32 key = _topicKeyFor(rule);
        if (_topicRefCount[key] == 0) {
            systemContract.subscribe(0, address(0), uint256(key), 0, 0, 0);
        }
        _topicRefCount[key] += 1;
        _ruleTopic[ruleId] = key;
    }

    /// @dev Decrements a topic count and unsubscribes when the last reference is released.
    function _releaseSubscription(uint256 ruleId) private {
        bytes32 key = _ruleTopic[ruleId];
        if (key == bytes32(0)) return;
        uint256 count = _topicRefCount[key];
        if (count <= 1) {
            _topicRefCount[key] = 0;
            systemContract.unsubscribe(0, address(0), uint256(key), 0, 0, 0);
        } else {
            _topicRefCount[key] = count - 1;
        }
        delete _ruleTopic[ruleId];
    }

    /// @dev The subscription identity for a rule: one topic per template/pair/token combination.
    function _topicKeyFor(RuleLib.Rule memory rule) private pure returns (bytes32 key) {
        key = keccak256(abi.encode(rule.template, rule.chainId, rule.pair, rule.tokenIn));
    }

    function _isActive(RuleLib.Rule storage rule) private view returns (bool) {
        return (rule.flags & RuleLib.FLAG_ACTIVE) != 0;
    }

    function _isCancelled(RuleLib.Rule storage rule) private view returns (bool) {
        return (rule.flags & RuleLib.FLAG_CANCELLED) != 0;
    }
}

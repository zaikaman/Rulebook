// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IReactive} from "@reactive/interfaces/IReactive.sol";

import {ChainConfig} from "../chain/ChainConfig.sol";
import {PriceMath} from "../libraries/PriceMath.sol";
import {RuleLib} from "../libraries/RuleLib.sol";
import {CallbackPayload, ExecutionPayload} from "../shared/CallbackPayload.sol";
import {CallbackConfiguration, IReactiveSystem} from "../shared/ReactiveTypes.sol";
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

    /// @notice One system-contract subscription a rule depends on, kept so it can be released.
    struct Subscription {
        bytes32 key;
        uint256 chainId;
        address source;
        uint256 topic0;
        uint256 topic2;
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
    /// @notice Emitted when an alert template fires. Alerts never request a callback.
    event AlertRaised(uint256 indexed ruleId, uint8 template, uint256 observed);
    /// @notice Emitted when the gas guard defers rules to the next wake-up.
    event EvaluationDeferred(uint256 indexed ruleId, uint256 gasRemaining);
    /// @notice Emitted when an account's execution credit falls below the warning threshold.
    event BudgetLow(uint256 reserved, uint256 threshold);
    /// @notice Emitted when the owner links a funds-side vault.
    event VaultLinked(uint256 indexed chainId, address indexed vault);

    /// @notice Topic0 of a Uniswap V2 pair's `Sync` event.
    bytes32 internal constant SYNC_TOPIC = keccak256("Sync(uint112,uint112)");
    /// @notice Topic0 of the Cron10000 tick the price/schedule templates listen to.
    bytes32 internal constant CRON_TOPIC = keccak256("Cron10000()");
    /// @notice Topic0 of an ERC20 `Transfer`.
    bytes32 internal constant TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");
    /// @notice Topic0 of the Vault's `Balances` event.
    bytes32 internal constant BALANCES_TOPIC =
        keccak256("Balances(address,uint256,address,uint256)");
    /// @notice Subscription key shared by every cron-gated rule in one account.
    bytes32 internal constant CRON_KEY = keccak256("rulebook.topic.cron10000");

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

    /// @notice Callback gas requested for a swap: the Vault quotes, swaps and emits (≥ 400k).
    uint64 public constant SWAP_CALLBACK_GAS = 400_000;
    /// @notice Callback gas requested for a transfer: one `transfer` plus the events (≥ 150k).
    uint64 public constant TRANSFER_CALLBACK_GAS = 150_000;
    /// @notice Tolerance baked into a swap's decision-time output floor. The Vault quotes from
    /// live reserves at execution; this floor only catches a large move in between (T174).
    uint256 public constant DECISION_SLIPPAGE_BPS = 200;
    /// @notice Default cron interval used when a stored schedule is zero, so a malformed rule
    /// cannot make the Agent run on every tick.
    uint256 public constant DEFAULT_SCHEDULE = 1 days;

    /// @notice The Reactive system contract allowed to call `react()`.
    IReactiveSystem public immutable systemContract;
    /// @notice Factory that deployed this agent, recorded for provenance.
    address public immutable factory;

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
    mapping(uint256 => address) private _vaults;
    mapping(address => uint256) private _cachedPrice;
    mapping(address => uint64) private _cachedPriceAt;
    mapping(address => uint256) private _cachedPriceBlock;
    mapping(address => uint256) private _previousPrice;
    mapping(uint256 => uint256) private _highWater;
    mapping(bytes32 => uint256) private _topicRefCount;
    mapping(uint256 => Subscription[2]) private _ruleSubscriptions;
    mapping(uint256 => MirrorConfig) private _mirrors;

    constructor(address owner_, IReactiveSystem system_, address factory_) Ownable(owner_) {
        systemContract = system_;
        factory = factory_;
        lastActivity = uint64(block.timestamp);
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
        lastActivity = uint64(block.timestamp);

        _acquireSubscriptions(ruleId, stored);
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
        _releaseSubscriptions(ruleId);
        emit RulePaused(address(this), ruleId, true);
    }

    /// @notice Resumes a paused rule and re-acquires its subscriptions.
    function resumeRule(uint256 ruleId) external onlyAgentOwner {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (_isCancelled(rule) || _isActive(rule)) revert RuleNotActive(ruleId);
        _reserveMonthlyBudget(rule.amountIn);
        rule.flags |= RuleLib.FLAG_ACTIVE;
        activeRules += 1;
        _acquireSubscriptions(ruleId, rule);
        emit RulePaused(address(this), ruleId, false);
        _emitBudgetLowIfLow();
    }

    /// @notice Cancels a rule permanently and releases its subscriptions.
    function cancelRule(uint256 ruleId) external onlyAgentOwner {
        RuleLib.Rule storage rule = _rules[ruleId];
        if (_isCancelled(rule)) revert RuleNotActive(ruleId);
        if (_isActive(rule)) {
            activeRules -= 1;
            _releaseMonthlyBudget(rule.amountIn);
        }
        _releaseSubscriptions(ruleId);
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
    /// @dev Evaluates rules in order, records fired runs, requests a callback for money
    /// templates, raises alerts for alert templates, and keeps the price cache fresh. Rules that
    /// do not fit the remaining gas are deferred, never allowed to revert the whole wake-up
    /// (a revert is charged in full).
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
            bool fired = _evaluatesTrue(ruleId, rule, log);
            if (fired) {
                _recordExecution(rule);
                if (RuleLib.isAlertTemplate(rule.template)) {
                    emit AlertRaised(ruleId, rule.template, _observedValue(rule, log));
                } else {
                    _requestCallback(ruleId, rule);
                }
            }
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
    function getSubscriptions(uint256 ruleId) external view returns (Subscription[2] memory subs) {
        subs = _ruleSubscriptions[ruleId];
    }

    /// @dev Decides whether a rule's condition holds for this observation. One branch per
    /// template, all fed by the same cache and the same `LogRecord` (US5).
    function _evaluatesTrue(
        uint256 ruleId,
        RuleLib.Rule storage rule,
        IReactive.LogRecord calldata log
    ) private returns (bool) {
        if (!_isActive(rule) || (rule.flags & RuleLib.FLAG_LATCHED) != 0) return false;
        uint8 template = rule.template;

        if (RuleLib.isCronTemplate(template)) {
            if (!_isCronTick(rule, log) || !_cronDue(rule)) return false;
            if (template == 1 || template == 7) return true;
            if (template == 2) return _dipped(rule);
            return _inactivityReached(rule);
        }

        if (template == 8 || template == 13) return _incomingTransferHits(rule, log);
        if (template == 9) return _balanceBelowFloor(rule, log);

        if (!_isSyncFor(log, rule.pair)) return false;
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
    function _dipped(RuleLib.Rule storage rule) private view returns (bool) {
        uint256 previous = _previousPrice[rule.pair];
        uint256 price = _cachedPrice[rule.pair];
        if (previous == 0 || price == 0) return false;
        return price * 10_000 <= previous * (10_000 - rule.secondary);
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
        returns (bool)
    {
        uint256 referencePrice = _highWater[ruleId];
        if (referencePrice == 0) referencePrice = rule.threshold;
        uint256 moved = price >= referencePrice
            ? ((price - referencePrice) * 10_000) / referencePrice
            : ((referencePrice - price) * 10_000) / referencePrice;
        if (moved < rule.secondary) return false;
        _highWater[ruleId] = price;
        return true;
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
        uint256 balance = token0 == rule.tokenIn ? balance0 : token1 == rule.tokenIn ? balance1 : 0;
        return balance < rule.threshold;
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

    /// @dev True when `log` is a Cron10000 tick for this rule's chain.
    function _isCronTick(RuleLib.Rule storage rule, IReactive.LogRecord calldata log)
        private
        view
        returns (bool)
    {
        return bytes32(log.topic_0) == CRON_TOPIC
            && log._contract == ChainConfig.get(rule.chainId).cronSource;
    }

    /// @dev True when a `Sync` for `pair` arrived on this observation.
    function _isSyncFor(IReactive.LogRecord calldata log, address pair)
        private
        pure
        returns (bool)
    {
        return bytes32(log.topic_0) == SYNC_TOPIC && log._contract == pair;
    }

    /// @dev Cron gating (T169): a tick fires at most once per stored schedule interval.
    /// Templates 2 and 10 store the schedule in `threshold`; 1 and 7 store it in `secondary`.
    function _cronDue(RuleLib.Rule storage rule) private view returns (bool) {
        uint8 template = rule.template;
        uint256 schedule = template == 2 || template == 10 ? rule.threshold : rule.secondary;
        if (schedule == 0) schedule = DEFAULT_SCHEDULE;
        if (rule.lastRun == 0) return true;
        return block.timestamp >= uint256(rule.lastRun) + schedule;
    }

    /// @dev Requests the funds-side callback for a fired money rule. The destination address of
    /// the callback is the chain's callback proxy; the Vault compares the first argument against
    /// its own `agent`, so nothing here is trusted blindly.
    function _requestCallback(uint256 ruleId, RuleLib.Rule storage rule) private {
        uint8 template = rule.template;
        bool swapping = RuleLib.isSwapTemplate(template);
        uint256 extra;
        if (swapping) {
            uint256 price = _cachedPrice[rule.pair];
            extra = price == 0
                ? 0
                : PriceMath.applySlippage(
                    (rule.amountIn * price) / PriceMath.PRICE_SCALE, DECISION_SLIPPAGE_BPS
                );
        } else {
            // Personal templates: template 9 pulls from the stored source wallet, 7/8/10 send to
            // the stored recipient. `encode.ts` stores either in `pair`.
            extra = uint256(uint160(rule.pair));
        }

        ExecutionPayload memory payload = ExecutionPayload({
            template: template,
            pair: rule.pair,
            threshold: rule.threshold,
            amountIn: rule.amountIn,
            expiry: uint64(rule.secondary),
            extra: extra
        });

        ChainConfig.Config memory chain = ChainConfig.get(rule.chainId);
        systemContract.requestCallbackV_1_0(
            CallbackConfiguration({
                chainId: rule.chainId,
                recipient: chain.callbackProxy,
                gasLimit: swapping ? SWAP_CALLBACK_GAS : TRANSFER_CALLBACK_GAS,
                payload: CallbackPayload.encode(ruleId, payload)
            })
        );
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

    /// @dev Refreshes the per-pair price cache from a `Sync` observation, and moves the
    /// dead-man clock forward when the owner's own wallet moves tokens.
    /// @dev Only a strictly newer `Sync` may replace the cache; an older observation (a replay or
    /// a reorg) is ignored, and a quiet pair keeps its last value rather than zeroing (T168).
    function _observe(IReactive.LogRecord calldata log) private {
        bytes32 topic0 = bytes32(log.topic_0);
        if (topic0 == TRANSFER_TOPIC && address(uint160(log.topic_1)) == owner()) {
            lastActivity = uint64(block.timestamp);
        }
        if (topic0 != SYNC_TOPIC) return;
        if (log.data.length < 64) return;
        if (log.block_number < _cachedPriceBlock[log._contract]) return;

        (uint112 reserve0, uint112 reserve1) = abi.decode(log.data, (uint112, uint112));
        if (reserve0 == 0 || reserve1 == 0) return;
        uint256 price = PriceMath.priceFromReserves(reserve0, reserve1);
        uint256 cached = _cachedPrice[log._contract];
        if (cached != 0) _previousPrice[log._contract] = cached;
        _cachedPrice[log._contract] = price;
        _cachedPriceAt[log._contract] = uint64(block.timestamp);
        _cachedPriceBlock[log._contract] = log.block_number;
    }

    /// @dev Which system subscriptions a rule needs, at most two per template.
    /// @dev Subscription keys are shared, so two rules on the same pair (or the same cron tick)
    /// hold one system subscription between them (T167).
    function _subscriptionsFor(RuleLib.Rule memory rule)
        private
        view
        returns (Subscription[2] memory subs)
    {
        ChainConfig.Config memory chain = ChainConfig.get(rule.chainId);
        address vault = _vaults[rule.chainId];
        uint256 slot;
        if (RuleLib.isCronTemplate(rule.template)) {
            subs[slot++] = Subscription({
                key: CRON_KEY,
                chainId: rule.chainId,
                source: chain.cronSource,
                topic0: uint256(CRON_TOPIC),
                topic2: 0
            });
        }
        if (RuleLib.isPriceTemplate(rule.template)) {
            subs[slot++] = Subscription({
                key: keccak256(abi.encode("sync", rule.pair)),
                chainId: rule.chainId,
                source: rule.pair,
                topic0: uint256(SYNC_TOPIC),
                topic2: 0
            });
        }
        if (rule.template == 8 || rule.template == 13) {
            subs[slot++] = Subscription({
                key: keccak256(abi.encode("transfer", rule.tokenIn, vault)),
                chainId: rule.chainId,
                source: rule.tokenIn,
                topic0: uint256(TRANSFER_TOPIC),
                topic2: uint256(uint160(vault))
            });
        }
        if (rule.template == 9) {
            subs[slot++] = Subscription({
                key: keccak256(abi.encode("balances", vault, rule.chainId)),
                chainId: rule.chainId,
                source: vault,
                topic0: uint256(BALANCES_TOPIC),
                topic2: 0
            });
        }
        if (rule.template == 10) {
            subs[slot++] = Subscription({
                key: keccak256(abi.encode("activity", owner(), rule.tokenIn)),
                chainId: rule.chainId,
                source: rule.tokenIn,
                topic0: uint256(TRANSFER_TOPIC),
                topic2: uint256(uint160(vault))
            });
        }
    }

    /// @dev Subscribes on the first reference to a topic key and increments its count.
    function _acquireSubscriptions(uint256 ruleId, RuleLib.Rule memory rule) private {
        Subscription[2] memory subs = _subscriptionsFor(rule);
        for (uint256 i = 0; i < 2; ++i) {
            bytes32 key = subs[i].key;
            if (key == bytes32(0)) continue;
            if (_topicRefCount[key] == 0) {
                systemContract.subscribe(
                    subs[i].chainId, subs[i].source, subs[i].topic0, 0, subs[i].topic2, 0
                );
            }
            _topicRefCount[key] += 1;
            _ruleSubscriptions[ruleId][i] = subs[i];
        }
    }

    /// @dev Decrements each topic count and unsubscribes when the last reference is released.
    function _releaseSubscriptions(uint256 ruleId) private {
        for (uint256 i = 0; i < 2; ++i) {
            Subscription memory sub = _ruleSubscriptions[ruleId][i];
            if (sub.key == bytes32(0)) continue;
            uint256 count = _topicRefCount[sub.key];
            if (count <= 1) {
                _topicRefCount[sub.key] = 0;
                systemContract.unsubscribe(sub.chainId, sub.source, sub.topic0, 0, sub.topic2, 0);
            } else {
                _topicRefCount[sub.key] = count - 1;
            }
            delete _ruleSubscriptions[ruleId][i];
        }
    }

    function _isActive(RuleLib.Rule storage rule) private view returns (bool) {
        return (rule.flags & RuleLib.FLAG_ACTIVE) != 0;
    }

    function _isCancelled(RuleLib.Rule storage rule) private view returns (bool) {
        return (rule.flags & RuleLib.FLAG_CANCELLED) != 0;
    }
}

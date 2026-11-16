# On-Chain Interface Contracts: Rulebook

**Feature**: `001-reactive-rule-builder` | **Date**: 2026-11-16

These are the authoritative interface shapes for contracts, frontend, and backend. Signatures follow `IDEA.md` §23 with the Reactive library details resolved in `research.md` R4. Implementations may add `internal` helpers; they may not change these signatures without an additive-migration note.

---

## 1. Shared types and errors

```solidity
// Template ids — generated from packages/shared/manifest/templates.json
// 1 DCA           2 DipBoostDCA    3 LimitBuy       4 TakeProfit     5 StopLoss
// 6 GridRebalance 7 RecurringTransfer 8 IncomeSweep  9 BalanceFloor  10 DeadManSwitch
// 11 PriceAlert   12 RangeAlert     13 LargeTransferAlert

// Custom errors only (Constitution IV) — no revert strings
error NotOwner();
error NotAgent();
error UnknownTemplate(uint8 template);
error UnsupportedChain(uint16 chainId);
error InvalidAmount();
error InvalidThreshold();
error InvalidSecondary();
error InvalidTemplateParams();
error RuleLimitReached(uint256 active, uint256 max);
error RuleNotActive(uint256 ruleId);
error RuleLatched(uint256 ruleId);
error ConditionNotMet();
error ExceedsPerRunCap(uint256 requested, uint256 cap);
error SlippageExceeded(uint256 minOut, uint256 actual);
error Expired(uint256 ruleId, uint64 expiry);
error CooldownActive(uint256 ruleId, uint64 readyAt);
error InsufficientPrincipal(uint256 required, uint256 available);
error TransferFailed();
error NotServiceProvider();
error CallbackSenderMismatch(address expected, address actual);
error MirrorDepthNotAllowed();
error MirrorBurstExceeded();
error DuplicateLeaderExecution(bytes32 key);
error TokenMismatch(address expected, address actual);
```

---

## 2. `IAgent` — Lasna, one per user

```solidity
interface IAgent is IReactive {
    event RuleCreated(address indexed agent, uint256 indexed ruleId, uint8 template, bool publicRule);
    event RulePaused(address indexed agent, uint256 indexed ruleId, bool paused);
    event RuleCancelled(address indexed agent, uint256 indexed ruleId);
    event RuleEvaluated(uint256 indexed ruleId, uint256 indexed originChainId,
                        bytes32 originTxHash, uint32 originLogIndex, bool fired);
    event EvaluationDeferred(uint256 indexed ruleId, uint256 gasRemaining);
    event BudgetLow(uint256 reserved, uint256 threshold);
    event VaultLinked(uint256 indexed chainId, address indexed vault);

    // --- owner-only configuration ---
    function addRule(Rule calldata rule, bool makePublic) external returns (uint256 ruleId);
    function pauseRule(uint256 ruleId) external;
    function resumeRule(uint256 ruleId) external;
    function cancelRule(uint256 ruleId) external;
    function resetRule(uint256 ruleId) external;              // re-arm a latched rule
    function reorderRules(uint256[] calldata ids) external;    // evaluation order, FR-014
    function linkVault(uint256 chainId, address vault) external;
    function addMirror(uint256 ruleId, MirrorConfig calldata config) external;

    // --- reactive entry point ---
    function react(LogRecord calldata log) external;          // onlySystem

    // --- views ---
    function owner() external view returns (address);
    function getRule(uint256 ruleId) external view returns (Rule memory);
    function getRuleIds() external view returns (uint256[] memory);   // in evaluation order
    function getVault(uint256 chainId) external view returns (address);
    function getCachedPrice(address pair) external view returns (uint256 price, uint64 observedAt);
    function activeRuleCount() external view returns (uint256);
}

struct MirrorConfig {
    uint256 leaderChainId;
    address leaderVault;
    uint256 leaderRuleId;
    uint16  scaleBps;     // <= 10_000
    uint256 perRunCap;
    uint8   hourlyCap;    // 1..10
}
```

### `react()` contract

| Aspect              | Contract                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Caller              | The Lasna system contract only (`onlySystem`). Any other caller reverts.                                                                   |
| Input               | `LogRecord` — routes on `topic0`, then `topic1/topic2` as needed by the template                                                           |
| Work per invocation | Iterate `order`; stop before `gasLeft()` would breach the safety margin; emit `EvaluationDeferred` for rules not reached                   |
| Side effects        | Update cache / high-water / `lastRun` / `runs` / latched; `requestCallbackV_1_0` for firing money rules; emit alert events for alert rules |
| Must not do         | Move funds, call `subscribe()`/`unsubscribe()`, assume anything about destination state, exceed 900k gas                                   |
| Revert policy       | A rule that cannot fire must be skipped, not revert the whole `react()` — a revert is charged in full                                      |

### Provenance for the proof page

`getCallbacks` supplies two of the three proof rows: the reactive transaction and the destination transaction. It does **not** supply the origin row, because the origin log is what triggered `react()` and is not part of the callback record. `LogRecord` carries it, so the Agent must publish it: every evaluation emits `RuleEvaluated` on Lasna with `originChainId`, `originTxHash`, and `originLogIndex` copied from the `LogRecord`.

The backfill join is therefore: Lasna receipt → `RuleEvaluated` (gives origin tx) → the receipt's own hash (the reactive tx) → `getCallbacks(thatHash)` (gives the destination tx). This is the only reason the proof page can render three rows without trusting our indexer, and it must be emitted on every evaluation, including evaluations that did not fire.

---

## 3. `IVault` — Unichain Sepolia, one per `(user, chainId)`

```solidity
interface IVault is IERC20Receiver {
    event Executed(uint256 indexed ruleId, address tokenIn, address tokenOut,
                   uint256 amountIn, uint256 amountOut, uint256 timestamp);
    event Mirrored(uint256 indexed ruleId, address indexed leader, bytes32 leaderTx);
    event Balances(address token0, uint256 balance0, address token1, uint256 balance1);
    event Deposited(address indexed token, uint256 amount, address indexed from);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event PayoutAddressChanged(address indexed previous, address indexed next);
    event LimitsChanged(uint256 maxSpendPerRun, address tokenIn, address tokenOut);

    // --- owner-only ---
    function withdraw(address token, uint256 amount, address to) external;
    function setPayoutAddress(address payout) external;
    function setLimits(uint256 maxSpendPerRun, address tokenIn, address tokenOut) external;
    function setPaused(bool paused) external;

    // --- agent-triggered (callback) ---
    function execute(address agent, uint256 ruleId, bytes calldata data) external;

    // --- views ---
    function owner() external view returns (address);
    function agent() external view returns (address);
    function router() external view returns (address);
    function paused() external view returns (bool);
    function mirrorMode() external view returns (bool);
    function maxSpendPerRun() external view returns (uint256);
    function principalOf(address token) external view returns (uint256);
}
```

### `execute()` contract — the money path

| Step                  | Requirement                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Authenticate       | Inherited `AbstractCallback`: `onlyServiceProvider` + `onlyCallbackSender(agent)`. `agent` is the **first** argument and is compared, never trusted.                                 |
| 2. Pause check        | `paused == false`, else `ConditionNotMet`                                                                                                                                            |
| 3. Decode             | `data` → `(uint16 template, address pair, uint256 threshold, uint256 minOut, uint64 expiry, uint256 extra)`; a decode failure reverts — it means a mismatched caller, not user error |
| 4. Re-check condition | Read reserves from `pair` **now**; recompute price via `PriceMath`; require the rule's condition still holds, else `ConditionNotMet`                                                 |
| 5. Re-check limits    | `amountIn <= maxSpendPerRun`; tokens match the allowlist; `block.timestamp <= expiry`                                                                                                |
| 6. Quote              | `amountOutMin = expectedOut(liveReserves, amountIn) * (10_000 - slippageBps) / 10_000` — **from live reserves, never from a cached price** (FR-028)                                  |
| 7. Execute            | `router.swapExactTokensForTokens(...)` with `amountOutMin`; or `SafeERC20.transfer` for transfer templates                                                                           |
| 8. Record             | `Executed(...)` (leader) or `Mirrored(...)` (mirror), then `Balances(...)`                                                                                                           |
| Gas                   | Callback `gasLimit` requested by the Agent ≥ 400k for swaps, ≥ 150k for transfers; protocol floor is 100k                                                                            |

---

## 4. Factories

```solidity
interface IAgentFactory {                 // Lasna
    event AgentDeployed(address indexed owner, address indexed agent, uint256 index);
    function deploy(address owner) external returns (address agent);
    function agentOf(address owner) external view returns (address);
}

interface IVaultFactory {                 // Unichain Sepolia
    event VaultDeployed(address indexed owner, address indexed vault, address indexed agent, uint256 chainId);
    function deploy(address owner, address agent, address tokenIn, address tokenOut) external returns (address vault);
    function vaultOf(address owner) external view returns (address);
}
```

**Ordering invariant** (FR-003): `AgentFactory.deploy` first, then `VaultFactory.deploy` with the resulting agent address. `Agent.linkVault(chainId, vault)` closes the loop. `VaultFactory` reverts `AgentAlreadyLinked()` if a vault already exists for `(owner, chainId)`, which is what makes onboarding idempotent-but-not-duplicating (FR-004).

---

## 5. Registry

```solidity
interface IRuleRegistry {                 // Unichain Sepolia
    event RuleListed(address indexed author, address indexed agent, uint256 indexed ruleId,
                     uint8 template, bytes32 paramsHash, string metadataURI);
    event RuleDelisted(address indexed author, address indexed agent, uint256 indexed ruleId);

    function list(uint8 template, bytes32 paramsHash, string calldata metadataURI, address agent, uint256 ruleId) external;
    function delist(address agent, uint256 ruleId) external;
    function getListing(address agent, uint256 ruleId) external view returns (Listing memory);
    function listingCount() external view returns (uint256);
}
```

Holds no funds and exposes no execution path. Only the listing author (the agent's owner, or a callback carrying that agent's identity) may write.

---

## 6. Composition: rule → callback payload

The Agent builds this payload for `requestCallbackV_1_0`; the frontend shows the resulting `addRule` calldata, not this payload, but both come from the same encoder in `packages/shared`.

```text
payload = abi.encodeWithSelector(
    IVault.execute.selector,
    address(0),        // overwritten by Reactive with the calling Agent address
    ruleId,
    abi.encode(template, pair, thresholdSnapshot, minOutBps, expiry, extra)
)
```

| Template                             | `extra` contents                                                |
| ------------------------------------ | --------------------------------------------------------------- |
| 1 DCA, 7 RecurringTransfer           | `0`                                                             |
| 2 DipBoostDCA                        | `secondary` (dip threshold bps)                                 |
| 3 LimitBuy, 4 TakeProfit, 5 StopLoss | `secondary` (expiry / trailing bps)                             |
| 6 GridRebalance                      | `secondary` (band bps); Agent rewrites `highWater` after fire   |
| 8 IncomeSweep, 13 LargeTransferAlert | observed `amountIn` from the `Transfer` payload                 |
| 9 BalanceFloor                       | source wallet address to `transferFrom`                         |
| 10 DeadManSwitch                     | `lastActivity` timestamp observed                               |
| 11 PriceAlert, 12 RangeAlert         | alert metadata only; recipient is the alert sink, never a vault |

---

## 7. Subscription topics

| Topic key                                                                     | Subscribed when                                                       | Released when                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| `keccak256("cron")` + cron interval id                                        | any cron-gated template is active (1, 2, 7, 10)                       | last such rule paused/cancelled        |
| `(pair, Sync.topic0)`                                                         | price templates active (1–6, 11, 12) or dip-boost needs a fresh cache | last rule referencing the pair is gone |
| `(token, Transfer.topic0, topic2 = vault)`                                    | 8, 13                                                                 | last such rule gone                    |
| `(vault, Balances.topic0)`                                                    | 9                                                                     | last such rule gone                    |
| `(userWallet, Transfer.topic0)`                                               | 10 (inactivity detection)                                             | rule gone                              |
| `(leaderVault, Executed.topic0)`                                              | mirror link exists                                                    | mirror cancelled                       |
| `Cron10000` preferred; `Cron1000` only when a window must be tight (~8× cost) | —                                                                     | —                                      |

Subscriptions are managed only from ordinary transactions (`addRule` / `pauseRule` / `cancelRule` / `addMirror`), never from `react()` (R5), and are reference-counted per topic key.

---

## 8. Events the backend must decode

| Chain            | Events                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lasna            | `RuleCreated`, `RulePaused`, `RuleCancelled`, `VaultLinked`, `RuleEvaluated`, `EvaluationDeferred`, `BudgetLow`, plus system-contract callback records read via `getCallbacks` |
| Unichain Sepolia | `Executed`, `Mirrored`, `Balances`, `Deposited`, `Withdrawn`, `RuleListed`, `RuleDelisted`, `Sync` (price observations, optional)                                              |

Decoding rule: every log is decoded by a generated viem decoder, validated by a zod schema, and only then written. An undecodable log is stored in a `dead_letter` table and surfaced in `/health`, never silently dropped (Constitution IV).

# Contract Audit & Upgradeability Conversation (2026-11-27)

## User

> audit the contracts, i want to make sure i dont have to keep redeploying because of making changes to the contracts constantly, and report back all the issues you find if there are any

## Assistant

This is a read-only audit of the contracts in `contracts/src/` (no source or test files were modified).

---

### Executive Summary

If you deploy the current contracts as-is (especially to Mainnet), **you will be forced to redeploy again soon** for two reasons:

1. **Structural headroom is exhausted:** `WorkflowAgentV2` (**24,336 B**, 240 B left) and `WorkflowVaultV2` (**24,309 B**, 267 B left) are ~1% away from the EVM 24,576-byte contract size limit (EIP-170), and every chain, pool, oracle, and operational limit is frozen as `immutable` inside non-upgradeable EIP-1167 clones.
2. **There are several real mainnet functional/economic bugs** — most notably a 16-round Chainlink lookback cap that breaks real-world trailing stops on Base Mainnet, a `run.previous` oracle check that causes `PRICE_RISES_THROUGH` / `PRICE_FALLS_THROUGH` to permanently miss >=5% price gaps, and an infinite callback-fee drain loop on `REFILL` workflows with a weekly budget.

---

### Part 1: Redeployment & Longevity Risks (Why You Keep Having to Redeploy)

#### R-1 [Critical] Both core contracts are ~240 bytes from the EIP-170 size limit; factories embed full initcode

Measured via `forge build --sizes` (Solc 0.8.29, `via_ir = true`, `optimizer_runs = 200`):

| Contract                                                                                      | Runtime Size | EIP-170 Margin | Initcode Size | EIP-3860 Margin |
| --------------------------------------------------------------------------------------------- | -----------: | -------------: | ------------: | --------------: |
| [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol)                       | **24,336 B** |      **240 B** |      26,828 B |        22,324 B |
| [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol)                       | **24,309 B** |      **267 B** |      27,056 B |        22,096 B |
| [WorkflowProgramValidatorV2.sol](../contracts/src/workflow/v2/WorkflowProgramValidatorV2.sol) |     11,581 B |       12,995 B |      11,607 B |        37,545 B |
| [WorkflowVaultFactoryV2.sol](../contracts/src/workflow/v2/WorkflowVaultFactoryV2.sol)         |      1,027 B |       23,549 B |  **42,249 B** |     **6,903 B** |
| [WorkflowAgentFactoryV2.sol](../contracts/src/workflow/v2/WorkflowAgentFactoryV2.sol)         |      2,037 B |       22,539 B |  **40,808 B** |     **8,344 B** |

- Adding even a single small feature, error branch, or setter to `WorkflowAgentV2` or `WorkflowVaultV2` will exceed 24,576 bytes and fail deployment.
- Both factories run `new WorkflowProgramValidatorV2()` and `new WorkflowVaultV2(...)` / `new WorkflowAgentV2(...)` inside their own constructors ([WorkflowVaultFactoryV2.sol](../contracts/src/workflow/v2/WorkflowVaultFactoryV2.sol#L46-L49), [WorkflowAgentFactoryV2.sol](../contracts/src/workflow/v2/WorkflowAgentFactoryV2.sol#L45-L47)). That bloats factory initcode past 40 KB and caused the Reactive Mainnet dry-run to estimate **~9.04M gas** in a single transaction ([run-latest.json](../contracts/broadcast/DeployWorkflowsV2.s.sol/1597/dry-run/run-latest.json#L17)).

#### R-2 [High] Hardcoded 2-chain limit and `immutable` external infrastructure brick existing users on any ecosystem change

- **Two-chain ceiling:** [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L177-L186) hardcodes scalar `immutable` fields for `primaryChain` and `secondaryChain` only (Unichain + Base). Adding a 3rd chain (Arbitrum, Optimism, Ethereum, etc.) requires redeploying the Agent, Vault, and Validator and migrating every user.
- **Single immutable pool, router, token pair, and oracle feeds:** [WorkflowProtocolsV2.sol](../contracts/src/workflow/v2/WorkflowProtocolsV2.sol#L50-L64) freezes `usdc`, `weth`, `router`, `pair`, `poolFee`, `ethUsdFeed`, `usdcUsdFeed`, `sequencerFeed`, `ethFeedMaxAge`, `usdcFeedMaxAge`, and `validator` as `immutable`. [ChainConfig.sol](../contracts/src/chain/ChainConfig.sol#L117-L154) pins Unichain Mainnet to the Uniswap V3 **0.30%** pool and Base Mainnet to a Uniswap **V2** pool.
  - If Chainlink deprecates/migrates an aggregator or changes a heartbeat (e.g., Base ETH/USD heartbeat moves to 3,600s, leaving zero buffer against `ethFeedMaxAge = 3_600`), or liquidity migrates to Uniswap V3 0.05% / Uniswap V4, or Reactive rotates `callbackProxy` / `cronSource`, **every deployed Vault and Agent breaks permanently**.

#### R-3 [High] Non-upgradeable clones + Marketplace coupled to the Agent Factory

- Factories deploy EIP-1167 clones pointing to an `immutable implementation` ([WorkflowVaultFactoryV2.sol](../contracts/src/workflow/v2/WorkflowVaultFactoryV2.sol#L18), [WorkflowAgentFactoryV2.sol](../contracts/src/workflow/v2/WorkflowAgentFactoryV2.sol#L36)). Every contract tweak forces a fresh factory set, forcing every user to abandon their old Vault/Agent, lose their non-refundable prepaid Reactive watching/callback credit, withdraw & re-deposit funds, and re-create workflows.
- **Marketplace listings live inside `WorkflowAgentFactoryV2`** ([WorkflowAgentFactoryV2.sol](../contracts/src/workflow/v2/WorkflowAgentFactoryV2.sol#L39-L93)) and the backend scopes them by `automationChain:agentFactory`. Every Agent redeploy wipes the Marketplace.

#### R-4 [Medium] Rigid operational constants baked into bytecode

Changing any of the following currently forces a full redeploy:

- `CALLBACK_GAS = 850_000`, `MAX_ACTIVE = 4`, `MAX_PENDING = 8`, `PRICE_COOLDOWN = 60 seconds`, `LIFETIME = 10 minutes`, `MAINNET_BLOCK_MS = 820`, `LASNA_BLOCK_MS = 2_000` ([WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L33-L51)).
- `PAYOUT_GRACE = 24 hours`, `PRICE_MAX_AGE = 1 hours`, and the 1-`PAYMENT`-workflow-per-Vault singleton (`paymentWorkflow`) ([WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L25-L26), [#L122](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L122), [#L266-L273](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L266-L273)).
- `MAX_PRICE_DEVIATION_BPS = 500`, `MAX_PEAK_DEVIATION_BPS = 200`, `MAX_PEAK_ORACLE_ROUNDS = 16`, `SEQUENCER_GRACE_PERIOD = 1 hours` ([WorkflowProtocolsV2.sol](../contracts/src/workflow/v2/WorkflowProtocolsV2.sol#L17-L19), [WorkflowProgramValidatorV2.sol](../contracts/src/workflow/v2/WorkflowProgramValidatorV2.sol#L11-L13)).
- `MAX_NODES = 15`, `MAX_DEPTH = 3`, `MAX_STEPS = 3`, `slippage <= 1000`, `interval` in `[120, 30 days]` ([WorkflowProgramV2.sol](../contracts/src/workflow/v2/WorkflowProgramV2.sol#L16-L18), [#L147-L150](../contracts/src/workflow/v2/WorkflowProgramV2.sol#L147-L150)).
- Outcome status classification (`SKIPPED` vs `FAILED` selector allowlist) in [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L400-L407).

---

### Part 2: Contract Bugs, Edge Cases & Security/Economic Findings

#### B-1 [High] Trailing stops (`TRAILING`) fail on Base Mainnet (and multi-hour moves) due to 16-round oracle lookback, and then spam callbacks

- **Locations:** [WorkflowProgramValidatorV2.sol](../contracts/src/workflow/v2/WorkflowProgramValidatorV2.sol#L13), [#L70-L116](../contracts/src/workflow/v2/WorkflowProgramValidatorV2.sol#L70-L116), [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L458-L471), [#L627-L638](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L627-L638)
- **What happens:** While ETH rallies from $3,000 to $3,500 and drifts back down before hitting a 10% trailing stop ($3,150), `WorkflowAgentV2.canTriggerPrice` correctly suppresses callbacks, so `Vault.memory_.peak` stays `0` while `Agent.highs[wf]` tracks $3,500. When ETH finally drops to $3,140, the Agent sends `run.high = 3500e18`. On the Vault, `_isPeakOracleConsistent` calls `verifyHistoricalPeak`, which walks back at most **`MAX_PEAK_ORACLE_ROUNDS = 16`** Chainlink rounds.
  - On Base Mainnet, ETH/USD Chainlink updates on tight deviation thresholds (~0.15%–0.5%) and frequent heartbeats — a 10% pullback or a 1–2 day hold easily spans **20–100+ rounds**.
  - `verifyHistoricalPeak` returns `false`, so the Vault discards `run.high = 3500e18`, records `memory_.peak = 3140e18`, evaluates `TRAILING` against $3,140, and returns `SKIPPED`.
  - Worse, the Agent still holds `highs[wf] = 3500e18`, so it keeps dispatching a callback every `PRICE_COOLDOWN` (60s) on every swap below $3,150, draining execution credit until ETH falls another 10% below $3,140.
- **Secondary issues in the same flow:**
  - `if (uint64(roundId) <= 1) break;` ([WorkflowProgramValidatorV2.sol](../contracts/src/workflow/v2/WorkflowProgramValidatorV2.sol#L81)) cannot cross a Chainlink phase upgrade boundary.
  - `checkIn(workflow)` ([WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L354-L360)) does not require the workflow to be an inactivity workflow; calling it on a `PRICE` workflow advances `memory_.lastCheckIn` to `block.timestamp`, causing `if (updatedAt < since) break;` to reject all historical oracle rounds.
  - `verifyHistoricalPeak` divides historical `ethUsd` by the _current_ `cache.usdcUsd` rather than the historical USDC/USD round.

#### B-2 [High] `PRICE_RISES_THROUGH` / `PRICE_FALLS_THROUGH` permanently miss legitimate >=5% gaps on low-volume pools or after pause/resume

- **Location:** [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L616-L625)
- **What happens:** Both crossing checks call `_guardOraclePrice(ctx.market, run.previous)` against the **current** Chainlink oracle (`MAX_PRICE_DEVIATION_BPS = 500` = 5%).
  - On lower-volume pools (Base V2 or Unichain V3 0.30%), during rapid volatility, or on the first swap after a weekly-budget pause/resume (while `prices[chain][pair]` was unsubscribed and sat stale), consecutive observed pool prices can legitimately differ by >=5% (e.g., `previous = $2,110` from hours ago, `observed = $1,980` matching current oracle).
  - `_guardOraclePrice(ctx.market, run.previous)` reverts `OraclePriceDeviation` (`FAILED`). On the next swap, `state.previousPrice` is now `$1,980` (already past the `$2,000` threshold), so the crossing is **permanently missed**.

#### B-3 [High] Infinite callback-fee drain loop on `REFILL` workflows with a weekly budget (and unfunded vaults)

- **Locations:** [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L665-L682), [WorkflowProgramV2.sol](../contracts/src/workflow/v2/WorkflowProgramV2.sol#L351-L352), [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L1074-L1112)
- **What happens:**
  1. Suppose a `REFILL` workflow (`USDC_BELOW(100)` -> `REFILL(100)`) has a 50 USDC weekly limit with 40 USDC already spent (10 USDC remaining), and Vault balance is 70 USDC (`needed = 30 USDC`).
  2. Unlike `allowed` and `ownerBalance`, `WorkflowVaultV2` does **not** clamp `REFILL` to remaining weekly budget (`10 USDC`). Instead, `40 + 30 > 50` reverts `WeeklyBudgetExceeded()` (`SKIPPED`) and emits `BudgetSynced(limit=50, spent=40)`.
  3. On `WorkflowAgentV2`, `inspectForAgent` encodes `REFILL`'s lower-bound cost as **`1` base unit** (`usdc += 1`), so `_budgetBlocks` sees `40e6 + 1 <= 50e6` -> `false` and **never pauses watching**.
  4. On every schedule tick (up to every 120 seconds) or swap for the rest of the week, the Agent keeps dispatching callbacks and burning the user's ETH execution credit and REACT watching credit.
  - Note: A similar unpaused callback loop occurs when a Vault runs out of USDC/WETH (`InsufficientVaultBalance`) or refill allowance (`InsufficientRefillAllowance`), because those outcomes do not trigger a pause on the Agent.

#### B-4 [Medium] `CALLBACK_GAS = 850_000` has not been tested against the real worst-case gas path

- **Locations:** [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L36), [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L389-L396), [WorkflowMainnetForkV2.t.sol](../contracts/test-fork/WorkflowMainnetForkV2.t.sol#L67)
- **What happens:** In the mainnet fork gas test, `run.high` is set to `spot + 1e18` (within 2% of latest oracle), so `verifyHistoricalPeak` is **never invoked**. In production, a 3-action leaf combining `verifyHistoricalPeak` (up to 16 nested Chainlink proxy->aggregator `getRoundData` calls, ~150k–250k gas) + a Uniswap V3 swap crossing multiple initialized ticks + 2 cold ERC-20 transfers + the `65_000` outcome reserve + callback proxy overhead can exhaust `850_000` gas, hitting `SettlementInterrupted()` with no way to raise `CALLBACK_GAS` without redeploying the Agent.

#### B-5 [Medium] Unichain Mainnet 24h oracle heartbeat + linear V3 quote creates false `SlippageExceeded` and wider MEV sandwich bounds

- **Locations:** [ChainConfig.sol](../contracts/src/chain/ChainConfig.sol#L125-L132), [WorkflowProtocolsV2.sol](../contracts/src/workflow/v2/WorkflowProtocolsV2.sol#L286-L306)
- **What happens:**
  - Unichain Mainnet uses `ethFeedMaxAge = 90_000` (25h) and `poolFee = 3_000` (0.30% V3 pool). Because `_swap` sets `floor = max(applySlippage(spotQuote, slippage), applySlippage(oracleQuote, slippage))`, normal drift between live spot and a stale oracle frequently causes legitimate swaps with <=1% slippage to revert `SlippageExceeded`.
  - Conversely, when the Chainlink feed lags in the _attacker's_ favor (e.g., ETH rallied 1.5% above the last Chainlink update while the user is selling WETH), an attacker can sandwich the swap down to `oracleFloor` (`oracleLag + slippage` worse than live spot).
  - Additionally, `_v3SpotPrice()` computes a zero-price-impact linear quote rather than a tick-aware quote (or TWAP), so larger trades against the thinner 0.30% pool fail slippage checks.

#### B-6 [Medium] `resumeWatching()` (permissionless) and `_syncBudget()` can re-subscribe trigger filters on an already-expired paused workflow

- **Locations:** [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L397-L412), [#L1152-L1165](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L1152-L1165)
- **What happens:** Unlike `_retryPending` ([WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L843)), neither `resumeWatching` nor `_syncBudget` checks `entry.expiry != 0 && block.timestamp > entry.expiry`. If a paused workflow expires and its week rolls over, anyone can call `resumeWatching(workflow)` to re-install trigger subscriptions (spending watching credit) on an expired workflow until a later `react()` retires it.

#### B-7 [Medium] Cross-chain `SCHEDULE` workflows with `PRICE_*` checks before `DIP_BY` bypass observation staleness checks

- **Locations:** [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L580-L595), [WorkflowProgramV2.sol](../contracts/src/workflow/v2/WorkflowProgramV2.sol#L198-L201)
- **What happens:** `validate()` allows any cross-chain `SCHEDULE` tree as long as `DIP_BY` appears _somewhere_ in the tree. However, the `run.observationTime` freshness check in `_evaluate()` only executes inside `if (check == P.DIP_BY && _usesOriginPrice(program))`. If a `PRICE_BELOW` / `PRICE_AT_LEAST` / `PRICE_AT_MOST` / `PRICE_OUTSIDE` node is evaluated before `DIP_BY` (or on `DIP_BY`'s `no` branch after `DIP_BY` rejected a stale observation), `ctx.price` is loaded from the stale `run.observed` with no age check at all (on testnet, where no oracle exists, it accepts arbitrarily old prices).

#### B-8 [Low] `canTriggerTransfer` misses `PERCENT` + `usdcCap` validation and dispatches provably doomed callbacks

- **Locations:** [WorkflowProgramV2.sol](../contracts/src/workflow/v2/WorkflowProgramV2.sol#L488-L504), [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L684-L687)
- **What happens:** `canTriggerTransfer` only checks `fixedUsdc > observed`; it ignores `PERCENT` spend in the total and never checks `> program.usdcCap`. A `PAYMENT` leaf with mixed `PERCENT + FIXED` exceeding `observed`, or a large payment whose `PERCENT` share exceeds `program.usdcCap`, will still dispatch a callback that provably reverts with `CapExceeded()` (`FAILED`).

#### B-9 [Low] Write-once `linkVault` and `WorkflowVaultFactoryV2.create(agent)` permanently brick a wallet on a single mistake

- **Locations:** [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L259-L267), [WorkflowVaultFactoryV2.sol](../contracts/src/workflow/v2/WorkflowVaultFactoryV2.sol#L52-L62)
- **What happens:** Neither `linkVault` (cross-chain, cannot verify target code) nor `create(agent)` allows correction even when `active.length == 0` / zero authorizations exist. Passing a wrong address once permanently bricks that wallet on that chain under that factory.

#### B-10 [Low] Minor operational & gas issues

- **No ERC-20 rescue on `WorkflowAgentV2`:** [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L269-L271) only withdraws native gas token; any ERC-20 sent to the Agent is locked forever.
- **No ownership transfer on Vault or Agent:** Users cannot rotate a compromised/migrating wallet key while keeping their prepaid non-refundable Reactive credit balances.
- **Wasted watching gas during `PRICE_COOLDOWN`:** [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L674-L677) loads `programs[entry.hash]` from storage and executes the external `validator.canTriggerPrice` staticcall _before_ checking `if (block.timestamp < info.cooldownUntil) return;`. Reordering those 2 lines saves watching credit on every swap during cooldown.
- **Empty revert conflated with Out-of-Gas:** [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L394-L396) reverts `SettlementInterrupted()` whenever `data.length == 0`. If an external router/token ever reverts with empty data, no `Outcome` is recorded.
- **`MAINNET_BLOCK_MS = 820` sensitivity:** [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L51) assumes Reactive Mainnet blocks stay <=820ms. If average block time slows to 1.2s, a 7-day pinned wake lands ~3.2 days late (though permissionless `resumeWatching` mitigates it).
- **`PAYMENT` triggers on owner's own `REFILL` / funding deposits:** [WorkflowAgentV2.sol](../contracts/src/workflow/v2/WorkflowAgentV2.sol#L696-L700) does not exclude `from == owner`, so funding a Vault or executing a `REFILL` triggers any active `PAYMENT` workflow that lacks a `PAYMENT_FROM` check.

#### B-11 [Informational] Hygiene & doc mismatches

- [Errors.sol](../contracts/src/shared/Errors.sol) contains 35 unused V1 custom errors (`RuleLimitReached`, `MonthlyCapExceeded`, `MirrorDepthNotAllowed`, etc.).
- [docs/workflows.md](workflows.md#L19) states "a path that buys WETH and then sells the WETH it just filled still settles", but [WorkflowProgramV2.sol](../contracts/src/workflow/v2/WorkflowProgramV2.sol#L262-L267) forbids more than one swap (`BUY`/`SELL`) per leaf (`SELL` -> `SEND` works, `BUY` -> `SELL` reverts `InvalidProgram`).
- [WorkflowVaultV2.sol](../contracts/src/workflow/v2/WorkflowVaultV2.sol#L238-L250) `setWeeklyBudget` allows updating weekly limits on permanently `closed` one-shot workflows.
- [deploy-workflows-v2.mjs](../scripts/deploy-workflows-v2.mjs#L415-L422) uses `LASNA_SYSTEM_CONTRACT` for both Lasna and Reactive Mainnet creation-hash verification (works today only because both chains use `0x8888...8888`).

---

### Part 3: Recommended Architecture Changes Before Redeploying (So You Stop Redeploying)

To stop redeploying everything on every feature, chain addition, or oracle/pool change **without sacrificing non-custodial user trust**:

1. **Extract a thin on-chain `ProtocolRegistry` (or `MarketRegistry`) per network** instead of `immutable` chain/pool/oracle/parameter fields:
   - Store `chainId -> {usdc, weth, router, pair, poolFee, ethUsdFeed, usdcUsdFeed, sequencerFeed, ethFeedMaxAge, usdcFeedMaxAge, callbackProxy, enabled}` in a mapping so you can add Arbitrum/Optimism/Ethereum, migrate a deprecated Chainlink feed, or move from V2/V3 0.30% to V3 0.05%/V4 **with zero Vault or Agent redeploys**.
   - Store tunable operational bounds (`callbackGas`, `maxActive`, `maxPending`, `blockMs`, `maxPriceDeviationBps`, `maxPeakDeviationBps`) in the registry with hard on-chain safety caps and a timelock (e.g. 24–48h) so an admin key cannot point swaps at a malicious router overnight.
2. **Use user-sovereign opt-in upgrades (UUPS + Factory-approved implementation registry, or Beacon with per-user opt-in):**
   - Replace immutable `Clones.clone(implementation)` with ERC-1967 proxies where **only the Vault/Agent `owner`** can call `upgradeTo(newImpl)` and only to an implementation approved in the Factory.
   - Result: Admin can never rug a user's Vault, yet when you ship a fix or new check/action, users upgrade in 1 transaction while keeping their Vault address, Agent address, prepaid Reactive credit, token balances, and workflow history.
3. **Decouple deployment & bytecode size:**
   - Deploy `WorkflowProgramValidatorV2`, `WorkflowVaultV2` implementation, and `WorkflowAgentV2` implementation **separately** and pass their addresses into the factories (cuts factory initcode from ~42 KB to ~2 KB and slashes Reactive Mainnet deploy gas).
   - Split swap/oracle execution (e.g., into a `SwapAdapter` / `ProtocolExecutor` library or module) and budget/pending-queue logic out of `WorkflowVaultV2` and `WorkflowAgentV2` to bring both well below ~18 KB (giving >6 KB of safe runway).
   - Separate the **Marketplace Registry** out of `WorkflowAgentFactoryV2` into its own standalone contract so Agent factory upgrades never wipe listings.
4. **Fix the mainnet bugs before freezing the next deployment:**
   - **B-1 (`TRAILING`):** Either track verified peaks via an on-chain Chainlink/TWAP checkpoint, allow the Agent to pass the **peak's exact Chainlink `roundId`** (O(1) verification on the Vault instead of scanning 16 rounds!), or enforce `checkIn` only on inactivity workflows. Passing the peak's `roundId` (or verifying `getRoundData(peakRoundId)` in 1 call!) completely eliminates the 16-round limit AND cuts ~200k gas from `CALLBACK_GAS`!
   - **B-2 (`PRICE_RISES_THROUGH` / `PRICE_FALLS_THROUGH`):** Similarly, verify `run.previous` against the oracle round at `previousBlock` (or remove the 5% current-oracle check on historical `previous` when `previous` is older than a threshold and rely on `observed` + live spot + sustained crossing).
   - **B-3 (`REFILL` + weekly budget):** Clamp `REFILL` `amount` to `min(needed, remainingWeeklyBudget, allowed, ownerBalance)` (and skip only when `remaining == 0`, in which case Agent's `usdc >= 1` lower bound _will_ pause watching cleanly!).
   - **B-4 (`CALLBACK_GAS`):** Make `CALLBACK_GAS` configurable (or tiered per action type) and test the fork suite with `verifyHistoricalPeak` actually executing.
   - **B-6, B-7, B-8, B-9, B-10:** Add `entry.expiry` checks in `resumeWatching`/`_syncBudget`, enforce `observationTime` freshness whenever `_usesOriginPrice(program)` loads `run.observed`, include `PERCENT` and `usdcCap` in `canTriggerTransfer`, allow `relinkVault` when no workflows for that chain are active, move the `cooldownUntil` check above `canTriggerPrice`, and add `withdrawToken` + 2-step ownership transfer.

If you'd like, I can design the exact upgradeable/registry architecture and fix these bugs in a targeted plan before touching any code.

---

## User

> quick question, am i allowed to just upgrade the contract instead of redeploying new ones?

## Assistant

**Short answer:** Yes, **going forward** — nothing in [hackathon-details.md](../hackathon-details.md) or [constitution.md](../.specify/memory/constitution.md) forbids upgradeable contracts. However, you **cannot** upgrade the contracts that are _already_ deployed on testnet right now — you have to do **one** deployment to switch to a proxy architecture first, and after that you can upgrade in place without redeploying user contracts or factories.

Here is the exact breakdown:

1. **Why the current testnet deployment cannot be upgraded in place**
   - EVM bytecode is immutable once deployed.
   - [WorkflowVaultFactoryV2.sol](../contracts/src/workflow/v2/WorkflowVaultFactoryV2.sol#L18) and [WorkflowAgentFactoryV2.sol](../contracts/src/workflow/v2/WorkflowAgentFactoryV2.sol#L36) deploy bare EIP-1167 minimal clones pointing to an `immutable implementation`, with no proxy upgrade slot.

2. **How upgrading works after one proxy deployment**
   - Your Factory deploys **ERC-1967 proxies** (UUPS or Beacon) instead of immutable clones.
   - When you fix a bug or add a feature later, you only deploy a new _implementation_ contract and update the pointer.
   - **What stays intact:** Factory addresses, Marketplace listings, every user's Vault and Agent addresses, token balances, active workflows, and non-refundable prepaid Reactive watching/execution credit (Reactive Network binds subscriptions and callbacks to the Agent/Vault proxy address, which never changes).

3. **Which upgrade pattern fits Rulebook best**
   - **User-opt-in UUPS (strongest for custody/judging):** You publish a new approved implementation on the Factory, and each Vault/Agent `owner` calls `upgradeToAndCall(...)` to opt in. You can never unilaterally change code that holds user funds, which preserves the non-custodial promise in [PRODUCT.md](../PRODUCT.md).
   - **BeaconProxy (fastest for iterating / fixing everyone at once):** One transaction on the Beacon upgrades all clones simultaneously. Very convenient on testnet or early rollout, though on mainnet you should put a timelock/multisig in front of it (or use Beacon for the non-custodial `Agent` / `Registry` and opt-in UUPS for the funds-holding `Vault`).

4. **Things to watch out for if you switch to upgradeable**
   - **Storage layout rules:** Never reorder, remove, or change types of existing state variables across upgrades — only append new ones (or use OpenZeppelin ERC-7201 namespaced storage).
   - **Document it:** Under Constitution Principle V ([constitution.md](../.specify/memory/constitution.md#L147-L152)), record the upgrade model in a short ADR under `docs/decisions/` and update the custody section of `PRODUCT.md` / `README.md` so it stays accurate.
   - **Contract size:** Because `WorkflowAgentV2` and `WorkflowVaultV2` only have ~240–267 bytes of EIP-170 margin left, adding UUPS upgrade logic will require extracting some logic (e.g., swap/oracle helpers or registry reads) at the same time so they stay under 24,576 bytes.

If you want, I can map out the cleanest proxy + registry + bug-fix plan before making any edits.

---

## User

> it'd be cheaper than deploying contracts right?

## Assistant

**Yes — significantly cheaper overall**, though how much cheaper depends on _what_ you are changing:

### Cost comparison: Current setup vs. Upgradeable + Registry

| Type of change                                                           | Current setup (full redeploy)                                                             | Upgradeable + Registry                                                                                     | Savings                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Add a chain / switch pool or oracle / tweak `CALLBACK_GAS` or limits** | Redeploy all 3 bundled factories (~9M gas each) + re-fund Agent & Vaults                  | **1 setter tx on Registry (~30k–80k gas)**                                                                 | **~99% cheaper**                                                                 |
| **Validator / pre-filter / oracle-helper change**                        | Redeploy full factory (~9M gas per chain) + user migration                                | Deploy only `Validator` (~2.5M gas) + 1 pointer update (~50k gas)                                          | **~70% cheaper**                                                                 |
| **Core `Vault` or `Agent` logic bug fix / feature**                      | Redeploy full bundled factory (~9M gas per chain) + re-create & re-fund all Agents/Vaults | Deploy only the changed implementation (~4–5M gas) + 1 upgrade tx (~50k gas) on only the chain(s) affected | **~45–50% cheaper in deploy gas**, plus **100% savings on user/test re-funding** |

### Where the biggest real savings come from

1. **No more stranded Reactive credit:** Right now every redeploy abandons your old Agent and Vaults along with their **non-refundable** prepaid `REACT` watching credit and `ETH` callback execution credit. Upgrading keeps the exact same Agent and Vault addresses, so you reuse all existing credit and balances.
2. **No bundled 9M-gas factory deploys:** Today [WorkflowAgentFactoryV2.sol](../contracts/src/workflow/v2/WorkflowAgentFactoryV2.sol#L43-L48) and [WorkflowVaultFactoryV2.sol](../contracts/src/workflow/v2/WorkflowVaultFactoryV2.sol#L22-L50) redeploy `Validator` + `Implementation` + `Factory` together every time (~41–42 KB initcode, ~9M gas on Reactive Mainnet). Separating them means you only pay to deploy the single piece that actually changed.
3. **Only pay on the chain that changed:** Fixing a Vault bug does not touch Reactive Mainnet (where `REACT` deploy gas is the most expensive part); fixing an Agent bug does not touch Unichain or Base.

### The small trade-off to know about

- **One-time migration deploy:** You still have to pay once to deploy the new upgradeable factories/registries.
- **Per-user creation & runtime gas:** Deploying an ERC-1967 proxy (`UUPS` or `BeaconProxy`) per user costs ~150k–250k gas instead of ~60k gas for an EIP-1167 clone (still pennies on Unichain/Base), and each call pays ~2,600 extra gas for the proxy slot read (negligible next to an 850k callback budget).

If you want, we can plan the exact upgradeable + registry + bug-fix refactor next so your next deployment is the last full one you have to do.

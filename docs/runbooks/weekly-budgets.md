# Weekly spending budgets

Weekly budgets are stored on each `WorkflowVaultV2` and enforced in the atomic settlement call. The Vault's spending counters reset on Monday at 00:00 UTC. The Agent allows a ten-minute buffer for cross-chain timing before treating its mirrored budget as reset.

The Agent mirrors the budget the Vault publishes in `BudgetSynced` (limits, spend, week start, revision) on every settlement and limit change, and records the smallest USDC and WETH amount each program path can consume. A triggering event whose paths are all guaranteed to exceed the mirrored week is not dispatched, so it incurs no settlement transaction or callback fee. The mirror is never larger than the Vault's own spend and never ahead of the week the Vault settles against, so gating can only drop runs the Vault would reject. A zero-cost path, such as an alert, stays eligible under the budget. The schedule is not advanced by a gated tick, so the next tick fires as soon as the week resets or the limits are raised.

A schedule or price workflow that the mirror proves blocked also stops watching. It removes its trigger subscriptions, keeps the settlement feedback filters, and pins one `Cron100` block for the mirrored reset. On that block it re-pins if the reset has not arrived yet; otherwise it restores the filters, and the next cron tick dispatches. Raising a limit publishes `BudgetSynced` and resumes immediately. `resumeWatching(workflow)` is a permissionless recovery path for a missed wake and still requires the mirrored budget to admit a path. Payment and transfer triggers are not paused because their origin log never repeats.

A gated payment or transfer trigger needs the waiting list because its origin log never repeats. The Agent parks the run (bounded to eight per workflow, deduplicated on the origin log) and retries it when the Vault publishes a new `BudgetSynced` snapshot or a Lasna cron tick observes the weekly reset. A queued retry retains the original event. If an in-flight payment races the budget, the Vault can also ask the Agent to requeue it. Disabling, re-enabling, or closing a workflow drops its waiting list.

## Preflight

1. Run `forge test` in `contracts`; the weekly matrix covers exact limits, independent USDC and WETH totals, percentage payments, refills, multi-action rollback, duplicate callbacks, failed runs, Monday boundaries, edits, pauses, stale edits, published budget snapshots, gated dispatches, watching pauses for schedules and prices, the pinned reset wake, early re-pinning, explicit resume, disable while paused, paths above the limit, zero-cost alert paths, reordered snapshots, and the cross-chain week-reset skew.
2. Run `npm run generate -w packages/shared` after `forge build`, then `npm run check:design` and `npm run verify`.
3. Review the `WorkflowWeeklyBudgetTest:testMultiActionRunFitsTheAgentCallbackGasLimit` result against the Agent's 1,200,000 gas request in `WorkflowAgentStorageV2`.
4. Confirm the gas snapshot difference contains only the expected settlement and authorization changes.

## Release

Use the staged testnet deployment procedure for new factories and the opt-in upgrade procedure for existing ERC-1967 proxies. Keep the backend and frontend deployment settings aligned. The indexer scopes each deployment by the automation chain ID and Agent factory address. [Deployment and upgrades](../../deployments/README.md) · [Application release and rollback](production-release.md)

## Live smoke

On each settlement chain being released, use a funded scheduled or price workflow and a separate payment or transfer workflow to verify retries.

1. Settle one run whose gross USDC or WETH input is within the weekly limit. Confirm the `Outcome` status is `CONFIRMED`, `weeklyBudget` reports the increased spend, and the receipt carries a `BudgetSynced` event with the same limits, spend, and week start.
2. Lower a limit below the week's spend, or spend the remaining amount, then let the next eligible event evaluate. Confirm the Agent requests no callback and removes the workflow's trigger subscriptions: `watchingPaused(workflow)` is true, `wakeBlock(workflow)` is the pinned reset block, no `Dispatched` event, no new Activity row, no settlement transaction, and no token balance change. The workflow stays active and stops consuming watching credit for its removed triggers. A callback that was already in flight still settles as `SKIPPED` with reason `WeeklyBudgetExceeded` and still shows **Run would exceed the weekly spending budget** in Activity and the public proof; that remains the last line of defense.
3. Confirm the approved increase with `setWeeklyBudget`, then let the next eligible event evaluate. Confirm the run dispatches again, the schedule and inactivity window did not restart, and the earlier spend is still counted in `weeklyBudget`. For the separate payment or transfer workflow, send an eligible event while its budget is exhausted and verify the parked run retries after the limit increases. Confirm a single settlement against the original event.
4. Confirm the reset behavior without a limit change: the pinned wake at or after ten minutes past Monday 00:00 UTC restores the trigger filters, the next cron tick dispatches again, and a parked payment or transfer run dispatches from the waiting list on the first cron tick after that boundary. If a wake was missed, `resumeWatching(workflow)` restores it once the mirrored budget admits a path.

## Release gate

- `forge test`, `npm run generate -w packages/shared`, `npm run check:design`, and `npm run verify` pass.
- The gas snapshot is reviewed, including the multi-action callback headroom.
- The browser checks pass at desktop and mobile widths, including the edit dialog's keyboard path.
- A subagent or second reviewer checks enforcement, the budget mirror and gated dispatch, stale-edit rejection, the skip reason, and the cutover configuration.
- The smoke records a gated trigger with no settlement transaction and a queued event that retries once the budget permits.
- CI is green and the production smoke above is recorded.

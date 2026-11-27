# Weekly spending budget rollout

Weekly budgets are stored on each `WorkflowVaultV2` and enforced in the atomic settlement call. The V2 program encoding and the Reactive callback payload are unchanged. This release also pauses watching on an exhausted budget, so it needs a fresh factory pair; existing Agents and Vaults stay immutable and their workflows must be re-created on the new pair.

The Agent mirrors the budget the Vault publishes in `BudgetSynced` (limits, spend, week start, revision) on every settlement and limit change, and records the smallest USDC and WETH amount each program path can consume. A triggering event whose paths are all guaranteed to exceed the mirrored week is not dispatched, so it costs neither a callback fee nor a Unichain transaction. The mirror is never larger than the Vault's own spend and never ahead of the week the Vault settles against, so gating can only drop runs the Vault would reject. A path that spends nothing, such as an alert, always dispatches. The schedule is not advanced by a gated tick, so the next tick fires as soon as the week resets or the limits are raised.

A schedule or price workflow that the mirror proves blocked also stops watching. It removes its trigger subscriptions, keeps the budget-sync and one-shot close filters, and pins one `Cron100` block at the weekly reset. On that block it re-pins if the reset has not arrived yet; otherwise it restores the filters, and the next cron tick dispatches. Raising a limit publishes `BudgetSynced` and resumes immediately. `resumeWatching(workflow)` is a permissionless recovery path for a missed wake and still requires the mirrored budget to admit a path. Payment and transfer triggers are not paused because their origin log never repeats.

A gated payment or transfer trigger needs the waiting list because its origin log never repeats. The Agent parks the run (bounded to eight per workflow, deduplicated on the origin log) and retries it when the Vault publishes a new `BudgetSynced` snapshot or a Lasna cron tick observes the weekly reset. The cron subscription exists only while the waiting list is non-empty, and each retry dispatches at most one parked run per workflow so a batch can never outrun the mirrored spend. Disabling, re-enabling, or closing a workflow drops its waiting list.

## Preflight

1. Run `forge test` in `contracts`; the weekly matrix covers exact limits, independent USDC and WETH totals, percentage payments, refills, multi-action rollback, duplicate callbacks, failed runs, Monday boundaries, edits, pauses, stale edits, published budget snapshots, gated dispatches, watching pauses for schedules and prices, the pinned reset wake, early re-pinning, explicit resume, disable while paused, paths above the limit, zero-cost alert paths, reordered snapshots, and the cross-chain week-reset skew.
2. Run `npm run generate -w packages/shared` after `forge build`, then `npm run check:design` and `npm run verify`.
3. Review the `WorkflowWeeklyBudgetTest:testMultiActionRunFitsTheAgentCallbackGasLimit` result against the Agent's 850,000 callback gas request. Raise `CALLBACK_GAS` in `WorkflowAgentV2` before deploying if the margin is thin.
4. Confirm the gas snapshot difference contains only the expected settlement and authorization changes.

## Deploy the fresh pair

Deploy `DeployWorkflowsV2.s.sol:DeployWorkflowsV2` on Reactive Lasna and Unichain Sepolia from the same commit. The script creates `WorkflowAgentFactoryV2` on Lasna and `WorkflowVaultFactoryV2` on Unichain Sepolia; the Vault factory creates its own `WorkflowProgramValidatorV2`.

Record the new addresses in `deployments/workflows-v2.json` with the transaction hash, block, source commit, creation-input hash, and runtime code hash. The record holds only the active pair; the backend, the frontend, and the release job read it directly.

## Switch the app and indexer together

Set the same values on the backend and frontend:

- `WORKFLOW_V2_DEPLOYMENT` and `VITE_WORKFLOW_V2_DEPLOYMENT`: the Lasna and Unichain factory addresses with their start blocks.

The backend runs on the Heroku app `rulebook-backend`. Update its `WORKFLOW_V2_DEPLOYMENT` config var with `node --env-file=backend/.env scripts/deploy-workflows-v2.mjs --record-only --heroku-app rulebook-backend`, or with `HEROKU_APP_NAME=rulebook-backend` during a normal deploy. Confirm it with `--check --heroku-app rulebook-backend`.

The database deployment key is the Lasna factory address, so the new indexer starts at the new start block without replaying an earlier one.

Deploy the frontend with `VITE_WORKFLOW_V2_ACTIVATION=true` only after the smoke test passes.

## Live smoke

Use a funded workflow on the new factories and record every receipt:

1. Settle one run whose gross USDC or WETH input is within the weekly limit. Confirm the `Outcome` status is `CONFIRMED`, `weeklyBudget` reports the increased spend, and the receipt carries a `BudgetSynced` event with the same limits, spend, and week start.
2. Lower a limit below the week's spend, or spend the remaining amount, then let the next eligible event evaluate. Confirm the Agent requests no callback and removes the workflow's trigger subscriptions: `watchingPaused(workflow)` is true, `wakeBlock(workflow)` is the pinned reset block, no `Dispatched` event, no new Activity row, no Unichain transaction, no token balance moved, and the workflow still active. Subsequent `Cron100` ticks must not increase the Agent's watching-credit spend. A callback that was already in flight still settles as `SKIPPED` with reason `WeeklyBudgetExceeded` and still shows **Run would exceed the weekly spending budget** in Activity and the public proof; that remains the last line of defense.
3. Confirm the approved increase with `setWeeklyBudget`, then let the next eligible event evaluate. Confirm the run dispatches again, the schedule and inactivity window did not restart, and the earlier spend is still counted in `weeklyBudget`. A payment or transfer run parked in step 2 settles from the waiting list without a new origin event.
4. Confirm the reset behavior without a limit change: the pinned wake at or after ten minutes past Monday 00:00 UTC restores the trigger filters, the next cron tick dispatches again, and a parked payment or transfer run dispatches from the waiting list on the first cron tick after that boundary. If a wake was missed, `resumeWatching(workflow)` restores it once the mirrored budget admits a path.

## Rollback

Because an Agent can link only one immutable Vault per settlement chain, rollback is a release-process action: restore the previous `WORKFLOW_V2_DEPLOYMENT` on both the frontend and backend, restore the matching record in `deployments/workflows-v2.json`, and redeploy the matching frontend. Do not delete indexed rows from the new deployment.

## Release gate

- `forge test`, `npm run generate -w packages/shared`, `npm run check:design`, and `npm run verify` pass.
- The gas snapshot is reviewed, including the multi-action callback headroom.
- The browser checks pass at desktop and mobile widths, including the edit dialog's keyboard path.
- A subagent or second reviewer checks enforcement, the budget mirror and gated dispatch, stale-edit rejection, the skip reason, and the cutover configuration.
- The smoke above records a gated tick that produced no Unichain transaction.
- CI is green and the production smoke above is recorded.

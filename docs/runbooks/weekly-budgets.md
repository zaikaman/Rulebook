# Weekly spending budget rollout

Weekly budgets are stored on each `WorkflowVaultV2` and enforced in the atomic settlement call. The V2 program encoding and the Reactive callback payload are unchanged, so a budget release only needs a fresh factory pair. Existing Agents are permanently linked to their Vaults and there are no users to migrate.

## Preflight

1. Run `forge test` in `contracts`; the weekly matrix covers exact limits, independent USDC and WETH totals, percentage payments, refills, multi-action rollback, duplicate callbacks, failed runs, Monday boundaries, edits, pauses, and stale edits.
2. Run `npm run generate -w packages/shared` after `forge build`, then `npm run check:design` and `npm run verify`.
3. Review the `WorkflowWeeklyBudgetTest:testMultiActionRunFitsTheAgentCallbackGasLimit` result against the Agent's 850,000 callback gas request. Raise `CALLBACK_GAS` in `WorkflowAgentV2` before deploying if the margin is thin.
4. Confirm the gas snapshot difference contains only the expected settlement and authorization changes.

## Deploy the fresh pair

Deploy `DeployWorkflowsV2.s.sol:DeployWorkflowsV2` on Reactive Lasna and Unichain Sepolia from the same commit. The script creates `WorkflowAgentFactoryV2` on Lasna and `WorkflowVaultFactoryV2` on Unichain Sepolia; the Vault factory creates its own `WorkflowProgramValidatorV2`.

Record the new addresses in `deployments/workflows-v2.json` with the transaction hash, block, source commit, creation-input hash, and runtime code hash. Keep every earlier factory entry in `deployments/lasna.json` and `deployments/unichain-sepolia.json`; do not rewrite historical addresses or receipts.

## Switch the app and indexer together

Set the same values on the backend and frontend:

- `WORKFLOW_V2_DEPLOYMENT` and `VITE_WORKFLOW_V2_DEPLOYMENT`: the new Lasna and Unichain factory addresses with their start blocks.
- `WORKFLOW_V2_ARCHIVED_DEPLOYMENTS`: a JSON array of earlier Lasna factory addresses whose indexed public proofs must stay readable. The backend uses this list only for `/v3/runs/:id`; the indexer continues to write the current deployment.

The database deployment key is the Lasna factory address. Rows from earlier deployments stay in `workflow_v2_*` tables. Cursors are per deployment, so the new indexer starts at the new start block without replaying the old one.

Deploy the frontend with `VITE_WORKFLOW_V2_ACTIVATION=true` only after the smoke test passes.

## Live smoke

Use a funded workflow on the new factories and record every receipt:

1. Settle one run whose gross USDC or WETH input is within the weekly limit. Confirm the `Outcome` status is `CONFIRMED` and `weeklyBudget` reports the increased spend.
2. Let the next eligible event evaluate after lowering a limit below the week's spend (or spending the remaining amount). Confirm `Outcome` status is `SKIPPED` with reason `WeeklyBudgetExceeded`, no token balance moved, and the workflow is still active.
3. Confirm the approved increase with `setWeeklyBudget`, then settle a new eligible event. Confirm the schedule and inactivity window did not restart and the earlier spend is still counted in `weeklyBudget`.
4. Open Activity and the public proof for the skipped run. Both must show **Run would exceed the weekly spending budget**.
5. Open a public proof from the previous factory pair and confirm the archived lookup still resolves it.

## Rollback

The old factories remain deployed and their records remain in the repository. Because an Agent cannot link a second Vault, rollback is a release-process action: restore the previous `WORKFLOW_V2_DEPLOYMENT` on both the frontend and backend, keep the new Lasna factory in `WORKFLOW_V2_ARCHIVED_DEPLOYMENTS`, and redeploy the matching frontend. Do not delete indexed rows from the new deployment.

## Release gate

- `forge test`, `npm run generate -w packages/shared`, `npm run check:design`, and `npm run verify` pass.
- The gas snapshot is reviewed, including the multi-action callback headroom.
- The browser checks pass at desktop and mobile widths, including the edit dialog's keyboard path.
- A subagent or second reviewer checks enforcement, stale-edit rejection, the skip reason, and the cutover configuration.
- CI is green and the production smoke above is recorded.

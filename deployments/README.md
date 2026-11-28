# Testnet deployment records

The JSON files here record the current factories: their deployment transactions, addresses,
deployers, source commits, and explorer links. For each deployment-script run, the commit
identifies the source that reproduces the creation bytecode with the pinned compiler and
libraries. Records come from successful Foundry broadcast receipts.

Reactive's Lasna system contract and the Unichain Sepolia / Base Sepolia callback proxies are network services.
Their entries identify the network and explorer, and the provider maintains their source and
deployment history.

When deploying again, compare the ignored `*.pending.json` address draft with the successful
receipts in Foundry's `contracts/broadcast/` directory. Replace the affected entries with the
confirmed transaction hash, block, timestamp and exact source commit. Keep private keys and
credential-bearing RPC URLs outside these files.

An entry with `"source": "working-tree"` and `"dirty": true` was deployed from uncommitted
sources. Its bytecode hashes still identify exactly what is running, but `commit` is only the
base revision. Replace `source` and `dirty` with `"commit"` once a commit contains that exact
source, and redeploy from the commit when reproducible evidence is required.

A weekly budget release deploys a fresh factory pair and replaces the entries in
`deployments/workflows-v2.json`. The backend, the frontend, and the release job all read that
file through their deployment settings, so the repository only needs the active pair. See the
[weekly budget rollout](../docs/runbooks/weekly-budgets.md).

- [Workflow V2 factories](./workflows-v2.json)
- [Published smoke receipts](./workflows-v2-smoke.json)
- [Legacy factory records](https://github.com/zaikaman/Rulebook/blob/75dd7930d025d627dd08a7d4e8c25c881594f411/deployments/workflows-v2.json)
- [Historical November 24 smoke receipts](https://github.com/zaikaman/Rulebook/blob/75dd7930d025d627dd08a7d4e8c25c881594f411/deployments/workflows-v2-smoke.json)

The staged candidate uses the local `workflows-v2.pending.json` and `workflows-v2-smoke.pending.json` files. The November 28 receipts cover both settlement chains. Promotion requires the exact deployed source in a clean commit and a passing strict deployment check. [Staged smoke evidence](../docs/submission-evidence.md#staged-erc-1967-smoke-verification)

## Cutover to ERC-1967 proxies

The legacy Lasna Agent factory creates immutable clones. The legacy Unichain and Base
Sepolia factories create Vaults directly. Owners need a new Agent and new Vaults to adopt the
upgradeable release. The legacy addresses remain accessible on-chain.

1. Keep the legacy factory records available during migration. For each wallet, revoke the
   Vault authorizations, then disable the Agent workflows. Confirm both transactions before
   moving principal. Revoke old token allowances and withdraw assets and direct native balances
   through the legacy contracts. Prepaid Reactive credits stay attached to the legacy addresses.
2. From the exact clean commit that passed CI, deploy candidates with
   `npm run deploy:workflows -- --stage --base`. Verify their runtime and configuration with
   `node scripts/deploy-workflows-v2.mjs --check --stage --require-artifacts --base`. Run
   `npx tsx scripts/smoke-workflows-v2.ts --stage --chains all` against the candidate factories.
   Set `SMOKE_PAYER_PRIVATE_KEY` to a second wallet with gas and at least 1.80 USDC on each funds chain.
3. After smoke passes, publish the tested candidate with
   `npm run deploy:workflows -- --promote-stage`, and include the updated record in the
   coordinated application release. Keep activations disabled during cutover.
4. Create a fresh Agent and Vaults with each wallet, link them, fund them, and authorize the
   desired workflows again. Review lifetime, spending limits and beneficiaries when signing.
   Marketplace listings and run history remain associated with their original deployment.
5. Enable activations once the new app and indexer use the verified record.

The strict staged check reads the React module's feedback module and the Vault
implementation's settlement module from their deployed contracts. It verifies
their runtime bytecode and configuration alongside the implementation and
factory. Keep the live record on the verified legacy deployment until the staged
Agent and Vaults pass the same clean-commit build and smoke test.

## Upgrading an existing proxy release

Review the storage layout of the Agent, its delegatecall modules, and both
Vault contracts before approving new implementations. Upgrade the settlement
Vaults before enabling Agent features that use their feedback events. Existing
subscriptions are removed using the exact filters that were installed. If an
upgrade changes the desired filters, call `refreshWorkflowFilters(workflow)`
as the Agent owner after upgrading each active workflow. This preserves its
authorization epoch, waiting payments, and budget. For a proxy from a build
before filter snapshots, refresh while the original factory's validator can
still reconstruct the installed filters.

If a Vault was created with the wrong Agent, its owner can call
`rebindAgent(correctAgent)` on the settlement chain. Confirm the address against
the active Agent factory before signing. Rebinding keeps the Vault address,
balances, and prepaid credits and invalidates its existing workflow
authorizations. Disable any old Agent workflows you control and authorize the
desired workflows again with higher epochs before enabling them.

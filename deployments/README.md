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

The backend, the frontend, and the release job use the active testnet deployment in
`workflows-v2.json`. The November 28, 2026 smoke receipts cover the promoted ERC-1967 proxies
on Lasna, Unichain Sepolia, and Base Sepolia. [Active testnet evidence](../docs/submission-evidence.md#active-testnet-deployment)

- [Workflow V2 factories](./workflows-v2.json)
- [Published smoke receipts](./workflows-v2-smoke.json)
- [Legacy factory records](https://github.com/zaikaman/Rulebook/blob/75dd7930d025d627dd08a7d4e8c25c881594f411/deployments/workflows-v2.json)
- [Historical November 24 smoke receipts](https://github.com/zaikaman/Rulebook/blob/75dd7930d025d627dd08a7d4e8c25c881594f411/deployments/workflows-v2-smoke.json)

## Deploy and verify a testnet candidate

1. From a clean commit that passed CI, deploy with `npm run deploy:workflows -- --stage --base`.
   This writes the local `workflows-v2.pending.json` candidate without changing the active record.
2. Run `node scripts/deploy-workflows-v2.mjs --check --stage --require-artifacts --base`. The strict
   check verifies the factory and implementation configuration and bytecode, including the Agent
   React and feedback modules and the Vault settlement module.
3. Run `npx tsx scripts/smoke-workflows-v2.ts --stage --chains all`. Set `SMOKE_PAYER_PRIVATE_KEY`
   to a second wallet with gas and at least 1.80 USDC on each settlement chain. The smoke script
   writes `workflows-v2-smoke.pending.json`.
4. Promote with `npm run deploy:workflows -- --promote-stage` after the staged checks pass.
   Include the updated records in the coordinated application release. Keep activations disabled
   during a factory cutover until the app and indexer use the verified records.

## Migrating wallets from the legacy deployment

The legacy Lasna Agent factory creates immutable clones. The legacy Unichain and Base
Sepolia factories create Vaults directly. Owners need a new Agent and new Vaults to adopt the
upgradeable release. The legacy addresses remain accessible on-chain.

1. Keep the legacy factory records available during migration. For each wallet, revoke the
   Vault authorizations, then disable the Agent workflows. Confirm both transactions before
   moving principal. Revoke old token allowances and withdraw assets and direct native balances
   through the legacy contracts. Prepaid Reactive credits stay attached to the legacy addresses.
2. Create and link a fresh Agent and Vaults with the same wallet on the active deployment.
   Fund the new addresses and authorize the desired workflows. Review lifetime, spending limits,
   and beneficiaries when signing. Marketplace listings and run history remain associated with
   their original deployment.

## Upgrading an existing proxy release

Review storage layout across the Agent, Vault, and their delegatecall modules. The factory
admin uses `approveImplementation(implementation, makeCurrent)` to approve an implementation
and optionally make it the default for new accounts. An existing proxy upgrades when its own
wallet owner calls `upgradeToAndCall` with the approved implementation. Upgrade the settlement
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

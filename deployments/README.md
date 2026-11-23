# Testnet deployment records

The JSON files here record the current factories: their deployment transactions, addresses,
deployers, source commits, and explorer links. For each deployment-script run, the commit
identifies the source that reproduces the creation bytecode with the pinned compiler and
libraries. Records come from successful Foundry broadcast receipts.

Reactive's Lasna system contract and Unichain Sepolia callback proxy are network services.
Their entries identify the network and explorer, and the provider maintains their source and
deployment history.

When deploying again, compare the ignored `*.pending.json` address draft with the successful
receipts in Foundry's `contracts/broadcast/` directory. Replace the affected entries with the
confirmed transaction hash, block, timestamp and exact source commit. Keep private keys and
credential-bearing RPC URLs outside these files.

A weekly budget release deploys a fresh factory pair and replaces the entries in
`deployments/workflows-v2.json`. The backend, the frontend, and the release job all read that
file through their deployment settings, so the repository only needs the active pair. See the
[weekly budget rollout](../docs/runbooks/weekly-budgets.md).

- [Workflow V2 factories](./workflows-v2.json)
- [Workflow V2 smoke receipts](./workflows-v2-smoke.json)

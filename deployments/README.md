# Testnet deployment records

The Lasna and Unichain Sepolia JSON files record deployment transactions, contract addresses,
deployers, source commits, and explorer links. Each configured address has an earlier,
superseded deployment recorded for reference.

For the two deployment-script runs, the commit identifies the source that reproduces
the creation bytecode with the pinned compiler and libraries. The first run matches
`1e4cbef`. The configured factories match `84ddf61`. The registry bytecode was unchanged
across those versions. Records come from successful Foundry broadcast receipts.

Reactive's Lasna system contract and Unichain Sepolia callback proxy are network services.
Their entries identify the network and explorer, and the provider maintains their source and
deployment history. The matching commit for the Phase 10 validation factories is
`b22172e`. [Phase 10 receipts](../docs/measurements.md#validation-contracts)

When deploying again, compare the ignored `*.pending.json` address draft with the successful
receipts in Foundry’s `contracts/broadcast/` directory. Keep the existing records and add
the confirmed transaction hash, block, timestamp and exact source commit for each new address.
Keep private keys and credential-bearing RPC URLs outside these files.

- [Reactive Lasna](./lasna.json)
- [Unichain Sepolia](./unichain-sepolia.json)

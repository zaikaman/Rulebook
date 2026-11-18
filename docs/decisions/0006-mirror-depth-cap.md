# 0006. Cap mirror depth through event types

**Status** Accepted

## Context

The indexer and UI need to distinguish a user's own trade from a follower trade.
Each follower also needs to authorize its spend and execution rate independently.

## Decision

Deploy a vault in one immutable mode. A standard vault accepts ordinary callbacks and
emits `Executed`. A mirror vault accepts mirror callbacks and emits `Mirrored` with the
leader vault and transaction hash. The follower subscribes to the leader vault's
`Executed` topic and its selected rule ID. A mirror trade emits no event that can trigger
another mirror, so the depth bound follows from the subscriptions and event types.

The follower Agent and Vault both deduplicate by leader vault, rule ID and transaction hash.
The Agent checks the rolling hourly cap and scales the leader's input up to the follower's
per-run cap. The follower vault uses the leader fill to derive a minimum acceptable rate, then
checks a fresh pool quote, its own slippage tolerance, and the received amount. A refusal
appears on the proof page with the reason returned by the callback.

## Consequences

Choose the vault mode during setup. Each owner keeps withdrawal access in either mode.
Each attachment creates a private follower rule and reserves its per-run cap in the Agent's
monthly budget. Detachment ends the rule and releases the reservation and subscription.
The source picker shows public swap rules with a compatible token pair and a standard vault.

Both updated factories are required because existing deployments are immutable. The proof
API uses the index to discover the follower's separate Lasna transaction, then verifies
its callback through `getCallbacks`. A follower proof also carries its leader transaction
in its chain provenance. See [Reactive callback documentation](https://dev.reactive.network/reactive-contracts#requesting-callbacks).

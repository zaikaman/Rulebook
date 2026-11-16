# 0005 — The proof endpoint reads the chain first

**Date**: 2026-11-16
**Status**: Accepted
**Context**: User Story 3 requires a proof that survives our own infrastructure. The backend
already indexes `RuleEvaluated` and keeps a `callbacks` table, but a database copy is not proof:
it can be stale, partially indexed, or simply down at judging time.

## Decision

`GET /v1/proofs/:reactiveTxHash` treats the chain as the primary source and the database as a
cache:

1. Read `getCallbacks(uint256)` from the Lasna system contract.
2. Read the Lasna receipt for the reactive hash and decode its `RuleEvaluated` log for the
   origin chain, transaction, and log index.
3. Read the origin receipt and each destination receipt from their own RPCs.
4. Build the three rows and the single latency figure from block timestamps.
5. Only after a successful chain read, upsert the callback records into `callbacks`.

If the chain read fails, the endpoint serves cached callback rows with `source: "cache"` and a
`cache_age_seconds` value. If the cached copy is older than 24 hours, or there is no cached copy
at all, the endpoint returns 503. An empty `getCallbacks` array is a 404 — it is never reported
as a successful proof.

## Consequences

- `cached: true` (wire value `source: "cache"`) means: the chain could not be read; this is the
  last confirmed copy we stored, and it is this many seconds old. It is never presented as live.
- The proof view does not require the indexer to be running. Lasna `getCallbacks` plus two public
  RPCs are enough for the automation and destination legs; `RuleEvaluated` supplies the origin
  leg without our database.
- The `callbacks` table is a cache with a TTL, not a source of truth. It is safe to truncate and
  rebuild (see `docs/runbooks/reindex-from-chain.md`).
- A destination callback with non-empty `error_data` is shown as a refusal: the raw selector is
  preserved next to a plain-language reason, and the row is never labelled a successful run.

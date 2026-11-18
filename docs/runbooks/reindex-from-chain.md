# Reindex from chain events

1. Verify the target database and record the current cursors and dead-letter count. Back up
   the database and retain the sponsor claim data. Apply pending migrations and set both
   `INDEXER_START_BLOCK_*` variables to the blocks immediately before the first relevant
   deployment on each chain. The poller starts at the following block.
2. Stop the live poller and take the API out of service while rebuilding its read model.
   Keep it stopped until replay reaches the configured confirmation depths.
3. With the backend environment loaded, run the replay and reconciliation from the repo root.

```powershell
Measure-Command { npm run reindex -w backend }
npm run verify:reconcile -w backend
```

Replay truncates the event-derived tables named in `backfill.ts`, resets the cursors,
and scans both chains in bounded ranges. Keep the configured starting blocks and RPCs
consistent across replay and normal operation. A restart repeats the rebuild from those
blocks. Seeded team listings and starter-funds claim records are preserved. Rule storage
and principal on-chain are unaffected.

Confirm the replay and reconcile commands both exit zero, the cursor positions have reached
the confirmed heads, and investigate any dead letters before restoring traffic. Check
`/health` after restarting. Reconciliation compares the indexed rule counters against the
execution rows. For an independent check, compare a sampled rule with its Agent storage.

At demo volume, plan for minutes when starting near the first demo transaction, plus any
RPC backoff. The actual runtime depends more on the block span than the number of events.
Time the replay on a staging copy before scheduling a production maintenance window.

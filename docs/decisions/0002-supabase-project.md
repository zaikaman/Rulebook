# 0002 — Supabase project as a derived read cache

**Date**: 2026-11-16
**Status**: Accepted

## Context

The UI needs queryable data — rule lists, event history, proof pages — that the chains
cannot answer cheaply from a browser. Supabase is the one hosted dependency that is not
load-bearing: if it disappears, the data can be rebuilt by replaying events. That property
is what makes it safe to run on a free plan with hard limits.

Free-plan constraints that shape the design:

- **500 MB database cap.** Not a limit the indexer can exceed by accident if it only stores
  events it needs, but it forbids storing raw logs or full transaction bodies.
- **Pause after 7 days of low activity.** A paused project wakes on the next request with a
  cold start of roughly 30 s. This is an availability event, not data loss.
- **No point-in-time recovery.** Backups are not a safety net; replay is.

## Decision

1. **Project**: `Rulebook`, ref `onvbgrphxiobacsviire`, region `ap-northeast-1` (Tokyo),
   Postgres 17.11, free plan, status `ACTIVE_HEALTHY` at creation.
   Project URL: `https://onvbgrphxiobacsviire.supabase.co`.
2. **Region**: Tokyo is the closest Supabase region to the target users. Heroku offers only
   `us` and `eu`; the backend runs in `eu` to match the operator's existing apps, so a
   cross-region hop is accepted. Indexing is asynchronous and never on a user request path,
   so latency costs throughput, not correctness.
3. **Everything is derived.** Every table is rebuildable from a block cursor plus the chain.
   No table is authoritative and none may hold state that cannot be reconstructed.
4. **Backend-only access.** The service-role key lives in Heroku config vars and is used
   only by the indexer/API. The SPA never receives a Supabase key — every read goes through
   the API — so row-level security is defence in depth, not the security boundary.
5. **Keep-alive, if enabled, must be a real `SELECT`** against a small table. A HEAD request
   or health ping does not count as activity and will not prevent a pause. A pause is
   handled by the indexer on wake-up, which resumes from its stored cursor.
6. **Never a key in this file.** No project key, JWT, or connection string with credentials
   is recorded here or in any committed file.

## Consequence

- Losing the project is a replay operation, not a restore. The indexer's cursor storage is
  therefore the only state worth protecting, and it is small.
- The 500 MB cap is monitored as an operational metric; ingest must stay restricted to
  events referenced by rules plus their execution outcomes.
- `psql` is not installed locally, so schema changes go through the Supabase CLI
  (`supabase link` then `supabase db push`) or the dashboard SQL editor.
- A `--output json` capability exists on the CLI, so provisioning details above are
  reproducible with `supabase projects list --output json`.

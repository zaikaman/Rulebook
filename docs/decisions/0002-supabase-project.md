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

1. **Project**: Reuse the existing Supabase project from the retired Second-Wind prototype,
   ref `iexsnxlgxxjedmgulnpa`. Project URL: `https://iexsnxlgxxjedmgulnpa.supabase.co`.
   Do not provision a second project for Rulebook.
2. **Region**: Inherit the existing project's region. Indexing is asynchronous and never on a
   user request path, so latency costs throughput, not correctness.
3. **Everything is derived.** Every table is rebuildable from a block cursor plus the chain.
   No table is authoritative and none may hold state that cannot be reconstructed.
4. **Backend-only access.** The reused service-role key lives only in ignored local env files
   or backend deployment config and is used only by the indexer/API. The SPA never receives
   a Supabase key — every read goes through the API — so row-level security is defence in
   depth, not the security boundary.
5. **Keep-alive, if enabled, must be a real `SELECT`** against a small table. A HEAD request
   or health ping does not count as activity and will not prevent a pause. A pause is
   handled by the indexer on wake-up, which resumes from its stored cursor.
6. **Never a key in this file.** No project key, JWT, or connection string with credentials
   is recorded here or in any committed file.

## Consequence

- Rulebook uses distinct table names and migrations in the shared project; do not run the
  Second-Wind migration set for Rulebook. Losing the project is a replay operation, not a
  restore. The indexer's cursor storage is therefore the only state worth protecting, and it
  is small.
- The 500 MB cap is monitored as an operational metric; ingest must stay restricted to
  events referenced by rules plus their execution outcomes.
- `psql` is not installed locally, so schema changes go through the Supabase CLI
  (`supabase link` then `supabase db push`) or the dashboard SQL editor.
- A `--output json` capability exists on the CLI, so provisioning details above are
  reproducible with `supabase projects list --output json`.

## Keep-alive job

Schedule one daily command from the repository root on the Heroku dyno:

```
node backend/dist/jobs/keepalive.js
```

It performs a real `SELECT` against `indexer_cursors` (not a health ping), which counts as
project activity and defers the free-plan pause. If the project is paused anyway, the
indexer resumes from its stored cursor on the next request.

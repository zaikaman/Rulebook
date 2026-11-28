# 0002 — Supabase project as a derived read cache

**Date**: 2026-11-16
**Status**: Accepted

## Context

The UI needs workflow lists, event history, and proof pages that would be expensive to query directly from the browser. Supabase hosts the backend's derived chain index and application state.

## Decision

1. Use the existing Rulebook Supabase project. The backend accesses it with the service role. The browser uses the Rulebook API.
2. Index chain-derived activity and inventory from the configured contract start blocks. The indexer keeps cursors so it can resume across restarts.
3. Back up application state, including workflow archive events, Telegram accounts and preferences, and assistant conversations. These records are stored by the app and cannot be recovered by replaying chain events.
4. Apply the tracked SQL migrations with `npm run migrate -w backend` using `DATABASE_URL` or `SUPABASE_DB_URL`. Heroku runs the same migration command during the release phase. [Release and database recovery](../runbooks/production-release.md)

## Keep-alive job

If the hosted project needs a keep-alive, the compiled backend includes `node backend/dist/jobs/keepalive.js`. It probes the database and runs a SELECT against `indexer_cursors` using the backend's configured Supabase credentials. [Job source](../../backend/src/jobs/keepalive.ts)

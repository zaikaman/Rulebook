alter table mirrors
  add column if not exists leader_vault text,
  add column if not exists per_run_cap numeric(78, 0) check (per_run_cap > 0),
  add column if not exists detached_at timestamptz;

create index if not exists rule_events_mirror_origin
  on rule_events (origin_tx)
  where kind = 'mirror_callback_requested';

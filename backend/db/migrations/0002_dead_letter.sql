-- An undecodable known-topic log is never dropped silently: it lands here and its count is
-- surfaced by /health so the indexer cannot quietly lose events.
create table if not exists dead_letter (
  id text primary key,
  chain_id int not null,
  block_number bigint not null,
  tx_hash text not null,
  log_index int not null,
  reason text not null,
  payload text not null,
  recorded_at timestamptz not null default now()
);
create index if not exists dead_letter_chain_idx on dead_letter (chain_id, block_number);

alter table dead_letter enable row level security;

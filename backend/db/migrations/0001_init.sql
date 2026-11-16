-- Derived read model. Every row is rebuildable by replaying chain logs; the chain is
-- authoritative for rules, principal, and execution outcomes.

create table if not exists agents (
  address text primary key,
  owner text not null,
  factory text not null,
  created_tx text not null,
  created_block bigint not null,
  rule_count int not null default 0,
  chain_id int not null default 5318007,
  indexed_at timestamptz not null default now()
);
create index if not exists agents_owner_idx on agents (owner);

create table if not exists vaults (
  address text primary key,
  owner text not null,
  agent text not null,
  chain_id int not null,
  mirror_mode boolean not null default false,
  allowed_token_in text,
  allowed_token_out text,
  max_spend_per_run numeric(78, 0),
  paused boolean not null default false,
  indexed_at timestamptz not null default now()
);
create index if not exists vaults_owner_idx on vaults (owner);
create index if not exists vaults_agent_idx on vaults (agent);

create table if not exists rules (
  agent text not null references agents (address),
  rule_id numeric(78, 0) not null,
  template smallint not null check (template between 1 and 13),
  chain_id int not null,
  status text not null check (status in ('active', 'paused', 'cancelled')),
  latched boolean not null default false,
  pair text,
  token_in text,
  token_out text,
  amount_in numeric(78, 0),
  threshold numeric(78, 0),
  secondary numeric(78, 0),
  last_run_at timestamptz,
  runs int not null default 0,
  is_public boolean not null default false,
  indexed_at timestamptz not null default now(),
  primary key (agent, rule_id)
);
create index if not exists rules_template_idx on rules (template);
create index if not exists rules_status_idx on rules (status);
create index if not exists rules_is_public_idx on rules (is_public);
create index if not exists rules_active_agent_idx on rules (agent) where status = 'active';

create table if not exists executions (
  chain_id int not null,
  tx_hash text not null,
  log_index int not null,
  vault text not null,
  agent text not null,
  owner text not null,
  rule_id numeric(78, 0) not null,
  kind text not null check (kind in ('executed', 'mirrored')),
  token_in text,
  token_out text,
  amount_in numeric(78, 0),
  amount_out numeric(78, 0),
  block_number bigint not null,
  block_time timestamptz not null,
  leader_tx text,
  status text not null default 'confirmed' check (status in ('confirmed', 'refused', 'pending')),
  indexed_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists executions_agent_time_idx on executions (agent, block_time desc);
create index if not exists executions_rule_idx on executions (rule_id);
create index if not exists executions_owner_time_idx on executions (owner, block_time desc);

create table if not exists callbacks (
  reactive_tx_hash text not null,
  callback_index int not null,
  reactive_contract text not null,
  destination_chain_id numeric(78, 0) not null,
  destination_tx_hash text,
  error_data text,
  block_number bigint not null,
  recorded_at timestamptz not null default now(),
  primary key (reactive_tx_hash, callback_index)
);

create table if not exists rule_events (
  chain_id int not null,
  tx_hash text not null,
  log_index int not null,
  agent text not null,
  rule_id numeric(78, 0) not null,
  kind text not null,
  block_time timestamptz not null,
  indexed_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists rule_events_agent_idx on rule_events (agent, block_time desc);

create table if not exists mirrors (
  follower_agent text not null,
  rule_id numeric(78, 0) not null,
  leader_agent text not null,
  leader_rule_id numeric(78, 0) not null,
  scale_bps int not null check (scale_bps <= 10000),
  hourly_cap int not null check (hourly_cap between 1 and 10),
  indexed_at timestamptz not null default now(),
  primary key (follower_agent, rule_id)
);

create table if not exists listings (
  chain_id int not null,
  listing_id numeric(78, 0) not null,
  agent text not null,
  rule_id numeric(78, 0) not null,
  template smallint not null check (template between 1 and 13),
  metadata_uri text not null default '',
  is_public boolean not null default true,
  author text not null,
  author_badge text not null default 'community' check (author_badge in ('team', 'community')),
  created_at timestamptz not null default now(),
  indexed_at timestamptz not null default now(),
  primary key (chain_id, listing_id)
);

create table if not exists indexer_cursors (
  chain_id int primary key,
  last_block bigint not null,
  last_block_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists sponsor_ledger (
  chain_id int not null,
  tx_hash text not null,
  log_index int not null,
  target text not null,
  amount numeric(78, 0) not null,
  asset text not null,
  block_time timestamptz not null,
  indexed_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);

create table if not exists price_observations (
  chain_id int not null,
  pair text not null,
  block_number bigint not null,
  price numeric(78, 0) not null,
  observed_at timestamptz not null,
  primary key (chain_id, pair, block_number)
);

alter table agents enable row level security;
alter table vaults enable row level security;
alter table rules enable row level security;
alter table executions enable row level security;
alter table callbacks enable row level security;
alter table rule_events enable row level security;
alter table mirrors enable row level security;
alter table listings enable row level security;
alter table indexer_cursors enable row level security;
alter table sponsor_ledger enable row level security;
alter table price_observations enable row level security;

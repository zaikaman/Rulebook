-- Hosted operational state, not derived from chain events: a starter-funds claim may be
-- recorded before its transfer is signed, so a retry can never double-send. It survives a
-- reindex on purpose.
create table if not exists starter_funds (
  owner text primary key,
  claimed_at timestamptz not null default now(),
  usdc_tx text,
  weth_tx text,
  amount_usdc numeric(78, 0) not null default 0,
  amount_weth numeric(78, 0) not null default 0,
  chain_id int not null,
  indexed_at timestamptz not null default now()
);

alter table starter_funds enable row level security;

-- Onboarding writes a vault row before the indexer has seen the deploy; the tx hash is what
-- lets the UI link straight to the creation transaction (T096).
alter table vaults add column if not exists created_tx text not null default '';

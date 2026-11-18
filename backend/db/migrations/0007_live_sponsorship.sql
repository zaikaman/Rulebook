create table live_orders (
  id uuid primary key,
  owner text not null,
  receiver text not null,
  price numeric(78, 0) not null check (price > 0),
  amount_in numeric(78, 0) not null check (amount_in between 1 and 100000000),
  nonce text not null unique,
  quote_block bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  deposit_ready_at timestamptz,
  payment_signature text,
  vault_signature text,
  vault_deadline numeric(78, 0),
  payment_hash text unique,
  refund_hash text unique,
  agent text,
  vault text,
  rule_id numeric(78, 0),
  renewal boolean not null,
  stage text not null check (stage in ('quote', 'payment', 'setup', 'authorize_vault', 'link', 'deposit', 'activate', 'active', 'refunding', 'refunded', 'expired')),
  funding text not null default 'checking' check (funding in ('checking', 'ready', 'needs_deposit', 'needs_attention', 'ineligible'))
);
create index live_orders_owner_created on live_orders (owner, created_at desc);
create unique index live_orders_one_pending on live_orders (owner)
  where stage in ('payment', 'setup', 'authorize_vault', 'link', 'deposit', 'activate', 'refunding');

create table live_transactions (
  hash text primary key,
  order_id uuid not null references live_orders(id),
  chain_id int not null check (chain_id in (5318007, 1301)),
  kind text not null check (kind in ('payment', 'agent', 'vault', 'wallet_gas', 'reserves', 'refund')),
  value numeric(78, 0) not null,
  gas_budget numeric(78, 0) not null,
  raw text not null,
  status text not null check (status in ('pending', 'confirmed', 'reverted')),
  created_at timestamptz not null default now()
);
create unique index live_transactions_pending_chain on live_transactions (chain_id) where status = 'pending';
create index live_transactions_order on live_transactions (order_id, chain_id, kind);
create index live_transactions_budget on live_transactions (chain_id, created_at);
alter table live_orders enable row level security;
alter table live_transactions enable row level security;
revoke all on live_orders, live_transactions from anon, authenticated;

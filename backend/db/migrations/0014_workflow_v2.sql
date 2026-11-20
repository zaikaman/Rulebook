create table workflow_v2_cursors (
  deployment text not null,
  chain integer not null,
  block_number bigint not null,
  primary key (deployment, chain)
);

create table workflow_v2_accounts (
  deployment text not null,
  chain integer not null,
  address text not null,
  owner text not null,
  agent text not null,
  primary key (deployment, chain, address),
  unique (deployment, chain, owner)
);

create table workflow_v2_activations (
  deployment text not null,
  chain integer not null,
  agent text not null,
  workflow_id text not null,
  epoch text not null,
  program_hash text not null,
  title text not null,
  primary key (deployment, chain, agent, workflow_id, epoch)
);

create table workflow_v2_runs (
  deployment text not null,
  chain integer not null,
  id text not null,
  agent text not null,
  workflow_id text not null,
  program_hash text not null,
  epoch text not null,
  origin_chain integer not null,
  origin_transaction text not null,
  origin_log_index text not null,
  lasna_transaction text not null,
  lasna_block bigint not null,
  expires_at bigint not null,
  primary key (deployment, chain, id)
);

create index workflow_v2_runs_by_agent on workflow_v2_runs (deployment, agent, lasna_block desc, id desc, chain desc);

create table workflow_v2_outcomes (
  deployment text not null,
  chain integer not null,
  run_id text not null,
  workflow_id text not null,
  vault text not null,
  epoch text not null,
  transaction_hash text not null,
  block_number bigint not null,
  log_index integer not null,
  status smallint not null check (status in (1, 2, 3, 4, 6)),
  reason text not null,
  path smallint check (path between 0 and 14),
  primary key (deployment, chain, transaction_hash, log_index)
);

create index workflow_v2_outcomes_by_run on workflow_v2_outcomes
  (deployment, chain, run_id, block_number desc, log_index desc);

create table workflow_v2_market_listings (
  deployment text not null,
  chain integer not null,
  id text not null,
  owner text not null,
  agent text not null,
  workflow_id text not null,
  program_hash text not null,
  program text not null,
  title text not null,
  description text not null,
  visible boolean not null,
  block_number bigint not null,
  log_index integer not null,
  primary key (deployment, id)
);

create index workflow_v2_market_list_newest on workflow_v2_market_listings
  (deployment, block_number desc, log_index desc) where visible;

alter table workflow_v2_cursors enable row level security;
alter table workflow_v2_accounts enable row level security;
alter table workflow_v2_activations enable row level security;
alter table workflow_v2_runs enable row level security;
alter table workflow_v2_outcomes enable row level security;
alter table workflow_v2_market_listings enable row level security;

create view workflow_v2_activity with (security_invoker = true) as
select r.*, a.owner, w.title, o.transaction_hash as destination_transaction, o.path,
  nullif(o.reason, '0x00000000') as reason,
  case
    when o.status = 1 then 'confirmed'
    when o.status = 2 then 'skipped'
    when o.status = 3 then 'expired'
    when o.status = 4 then 'failed'
    when o.status = 6 then 'in grace period'
    when r.expires_at <= extract(epoch from statement_timestamp()) then 'expired'
    else 'pending'
  end as status
from workflow_v2_runs r
join workflow_v2_accounts a on a.deployment = r.deployment and a.chain = 5318007 and a.address = r.agent
join workflow_v2_activations w on w.deployment = r.deployment and w.chain = r.chain
  and w.agent = r.agent and w.workflow_id = r.workflow_id and w.epoch = r.epoch and w.program_hash = r.program_hash
left join lateral (
  select outcome.status, outcome.reason, outcome.transaction_hash, outcome.path
  from workflow_v2_outcomes outcome
  join workflow_v2_accounts v on v.deployment = outcome.deployment and v.chain = outcome.chain
    and v.address = outcome.vault and v.agent = r.agent and v.owner = a.owner
  where outcome.deployment = r.deployment and outcome.chain = r.chain and outcome.run_id = r.id
    and outcome.workflow_id = r.workflow_id and outcome.epoch = r.epoch
  order by outcome.block_number desc, outcome.log_index desc
  limit 1
) o on true;

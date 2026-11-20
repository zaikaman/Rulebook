create table workflow_index_cursors (
  chain text primary key,
  block_number bigint not null
);
create table workflow_agents (
  address text primary key,
  owner text not null unique
);
create table workflow_vaults (
  address text primary key,
  owner text not null unique,
  agent text not null
);
create index workflow_vaults_agent on workflow_vaults (agent);
create table workflow_authorizations (
  vault text not null,
  workflow_id text not null,
  epoch numeric(20) not null,
  program_hash text not null,
  primary key (vault, workflow_id, epoch)
);
create table workflow_activations (
  agent text not null,
  workflow_id text not null,
  epoch numeric(20) not null,
  program_hash text not null,
  title text not null,
  source_listing numeric(78) not null,
  primary key (agent, workflow_id, epoch)
);
create index workflow_activations_source on workflow_activations (source_listing) where source_listing > 0;
create table workflow_decisions (
  id text primary key,
  agent text not null,
  workflow_id text not null,
  program_hash text not null,
  program text not null,
  epoch numeric(20) not null,
  leaf integer not null,
  observed text not null,
  origin_chain integer not null,
  origin_transaction text not null,
  origin_log_index text not null,
  lasna_transaction text not null,
  lasna_block bigint not null,
  expires_at bigint not null,
  skipped boolean not null
);
create index workflow_decisions_history on workflow_decisions (agent, workflow_id, lasna_block desc, id);
create index workflow_decisions_listing on workflow_decisions (agent, workflow_id, program_hash);
create table workflow_outcomes (
  id text primary key,
  vault text not null,
  workflow_id text not null,
  program_hash text not null,
  epoch numeric(20) not null,
  leaf integer not null,
  destination_transaction text not null,
  completed boolean not null,
  reason text not null
);
create table workflow_steps (
  id text not null,
  step integer not null,
  vault text not null,
  destination_transaction text not null,
  kind integer not null,
  amount text not null,
  received text not null,
  recipient text not null,
  primary key (id, step)
);
create table workflow_market_listings (
  id numeric(78) primary key,
  author text not null,
  agent text not null,
  workflow_id text not null,
  program_hash text not null,
  program text not null,
  title text not null,
  description text not null,
  tags text[] not null,
  trigger text not null,
  visible boolean not null,
  published_block bigint not null
);

alter table workflow_index_cursors enable row level security;
alter table workflow_agents enable row level security;
alter table workflow_vaults enable row level security;
alter table workflow_authorizations enable row level security;
alter table workflow_activations enable row level security;
alter table workflow_decisions enable row level security;
alter table workflow_outcomes enable row level security;
alter table workflow_steps enable row level security;
alter table workflow_market_listings enable row level security;

create view workflow_verified_outcomes with (security_invoker = true) as
select o.*
from workflow_outcomes o
join workflow_decisions d on o.id = d.id and o.workflow_id = d.workflow_id
  and o.program_hash = d.program_hash and o.epoch = d.epoch and o.leaf = d.leaf
join workflow_vaults v on v.address = o.vault and v.agent = d.agent
join workflow_agents a on a.address = d.agent and a.owner = v.owner;

create view workflow_marketplace with (security_invoker = true) as
select l.*,
  (select count(*) from workflow_decisions d
   join workflow_verified_outcomes o on o.id = d.id and o.completed
   where d.agent = l.agent and d.workflow_id = l.workflow_id and d.program_hash = l.program_hash) as runs,
  (select count(distinct a.owner) from workflow_activations w
   join workflow_agents a on a.address = w.agent
   join workflow_vaults v on v.owner = a.owner and v.agent = a.address
   join workflow_authorizations x on x.vault = v.address and x.workflow_id = w.workflow_id
     and x.epoch = w.epoch and x.program_hash = w.program_hash
   where w.source_listing = l.id and a.owner <> l.author) as copies
from workflow_market_listings l
where l.visible;

create function browse_workflow_marketplace(
  search_text text, filter_tag text, filter_trigger text, sort_mode text,
  after_score bigint, after_id numeric, page_size integer
) returns table (item jsonb, score bigint, listing_id text)
language sql stable set search_path = public as $$
  with matches as (
    select m.*, case sort_mode when 'runs' then m.runs when 'newest' then m.published_block else m.copies end as rank_score
    from workflow_marketplace m
    where (search_text = '' or position(lower(search_text) in lower(m.title || ' ' || m.description)) > 0)
      and (filter_tag = '' or filter_tag = any(m.tags))
      and (filter_trigger = '' or filter_trigger = m.trigger)
  )
  select to_jsonb(matches) || jsonb_build_object('id', matches.id::text), rank_score, matches.id::text
  from matches
  where after_id is null or (rank_score, matches.id) < (after_score, after_id)
  order by rank_score desc, matches.id desc
  limit page_size;
$$;
revoke all on function browse_workflow_marketplace(text,text,text,text,bigint,numeric,integer) from public, anon, authenticated;
grant execute on function browse_workflow_marketplace(text,text,text,text,bigint,numeric,integer) to service_role;


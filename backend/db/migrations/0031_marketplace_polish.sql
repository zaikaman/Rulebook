-- Add searchable/filterable listing metadata and verified-run marketplace browse RPCs.

alter table workflow_v2_market_listings
  add column if not exists origin_chain integer,
  add column if not exists trigger smallint check (trigger is null or trigger in (1, 2, 3, 4));

-- Backfill origin_chain and trigger from ABI-encoded WorkflowV2Program bytes.
-- ABI tuple layout (with leading 0x):
--   word 0 (3..66):   tuple offset 0x20
--   word 1 (67..130): uint8 version = 2
--   word 2 (131..194): uint32 chain
--   word 3 (195..258): uint32 originChain
--   word 4 (259..322): uint8 trigger
update workflow_v2_market_listings
set
  origin_chain = ('x' || substring(program from 251 for 8))::bit(32)::int,
  trigger = case
    when ('x' || substring(program from 315 for 8))::bit(32)::int in (1, 2, 3, 4)
      then ('x' || substring(program from 315 for 8))::bit(32)::int::smallint
    else null
  end
where origin_chain is null
  and length(program) >= 322
  and program ~ '^0x[0-9a-fA-F]+$'
  and substring(program from 3 for 64) = repeat('0', 62) || '20'
  and substring(program from 67 for 64) = repeat('0', 62) || '02'
  and substring(program from 195 for 56) = repeat('0', 56)
  and substring(program from 251 for 1) ~ '^[0-7]$'
  and ('x' || substring(program from 251 for 8))::bit(32)::int > 0
  and substring(program from 259 for 56) = repeat('0', 56);

update workflow_v2_market_listings
set origin_chain = chain
where origin_chain is null;

create index if not exists workflow_v2_runs_by_program_hash
  on workflow_v2_runs (deployment, chain, program_hash);

create index if not exists workflow_v2_runs_by_agent_workflow
  on workflow_v2_runs (deployment, chain, agent, workflow_id);

create index if not exists workflow_v2_market_list_filters
  on workflow_v2_market_listings (deployment, chain, origin_chain, trigger, block_number desc, log_index desc)
  where visible;

create or replace function workflow_v2_marketplace_browse(
  p_deployment text,
  p_chains integer[],
  p_query text default null,
  p_cross_chain boolean default null,
  p_trigger smallint default null,
  p_before_block bigint default null,
  p_before_index integer default null,
  p_limit integer default 25
)
returns table (
  id text,
  owner text,
  agent text,
  workflow_id text,
  program_hash text,
  program text,
  chain integer,
  origin_chain integer,
  trigger smallint,
  title text,
  description text,
  block_number bigint,
  log_index integer,
  verified_runs integer
) language sql stable set search_path = public as $$
  with params as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as raw_query,
      greatest(1, least(coalesce(p_limit, 25), 50)) as row_limit
  ),
  escaped as (
    select
      case
        when raw_query is null then null
        else '%' || replace(replace(replace(raw_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as pattern,
      row_limit
    from params
  )
  select
    l.id,
    l.owner,
    l.agent,
    l.workflow_id,
    l.program_hash,
    l.program,
    l.chain,
    coalesce(l.origin_chain, l.chain) as origin_chain,
    l.trigger,
    l.title,
    l.description,
    l.block_number,
    l.log_index,
    (
      select count(*)::integer
      from workflow_v2_activity a
      where a.deployment = l.deployment
        and a.chain = l.chain
        and a.status = 'confirmed'
        and (
          a.program_hash = l.program_hash
          or (a.agent = l.agent and a.workflow_id = l.workflow_id)
        )
    ) as verified_runs
  from workflow_v2_market_listings l
  cross join escaped e
  where l.deployment = p_deployment
    and l.visible = true
    and l.chain = any(p_chains)
    and (
      e.pattern is null
      or l.title ilike e.pattern escape '\'
      or l.description ilike e.pattern escape '\'
    )
    and (
      p_cross_chain is null
      or (coalesce(l.origin_chain, l.chain) <> l.chain) = p_cross_chain
    )
    and (p_trigger is null or l.trigger = p_trigger)
    and (
      p_before_block is null
      or l.block_number < p_before_block
      or (l.block_number = p_before_block and l.log_index < coalesce(p_before_index, 0))
    )
  order by l.block_number desc, l.log_index desc
  limit (select row_limit from escaped);
$$;

create or replace function workflow_v2_marketplace_listing(
  p_deployment text,
  p_id text,
  p_chains integer[]
)
returns table (
  id text,
  owner text,
  agent text,
  workflow_id text,
  program_hash text,
  program text,
  chain integer,
  origin_chain integer,
  trigger smallint,
  title text,
  description text,
  block_number bigint,
  log_index integer,
  verified_runs integer
) language sql stable set search_path = public as $$
  select
    l.id,
    l.owner,
    l.agent,
    l.workflow_id,
    l.program_hash,
    l.program,
    l.chain,
    coalesce(l.origin_chain, l.chain) as origin_chain,
    l.trigger,
    l.title,
    l.description,
    l.block_number,
    l.log_index,
    (
      select count(*)::integer
      from workflow_v2_activity a
      where a.deployment = l.deployment
        and a.chain = l.chain
        and a.status = 'confirmed'
        and (
          a.program_hash = l.program_hash
          or (a.agent = l.agent and a.workflow_id = l.workflow_id)
        )
    ) as verified_runs
  from workflow_v2_market_listings l
  where l.deployment = p_deployment
    and l.visible = true
    and l.id = p_id
    and l.chain = any(p_chains)
  limit 1;
$$;

do $$
declare
  target record;
  role_name text;
begin
  for target in
    select 'function' as kind, oid::regprocedure::text as name from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('workflow_v2_marketplace_browse', 'workflow_v2_marketplace_listing')
  loop
    execute format('revoke all on %s %s from public', target.kind, target.name);
    for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
      execute format('revoke all on %s %s from %I', target.kind, target.name, role_name);
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on %s %s to service_role', target.kind, target.name);
    end if;
  end loop;
end;
$$;

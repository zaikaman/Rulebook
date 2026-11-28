create table workflow_v2_inventory_cursors (
  deployment text not null,
  chain integer not null,
  block_number bigint not null,
  block_hash text,
  primary key (deployment, chain)
);

create table workflow_v2_authorization_events (
  deployment text not null,
  chain integer not null,
  vault text not null,
  workflow_id text not null,
  epoch numeric(20, 0) not null check (epoch > 0),
  block_number bigint not null,
  log_index integer not null,
  primary key (deployment, chain, block_number, log_index)
);

create index workflow_v2_authorization_by_vault
  on workflow_v2_authorization_events (deployment, chain, vault, workflow_id, epoch desc);

create table workflow_v2_archive_events (
  deployment text not null,
  chain integer not null,
  owner text not null,
  workflow_id text not null,
  revision bigint not null check (revision > 0),
  epoch numeric(20, 0) not null check (epoch > 0),
  archived boolean not null,
  created_at timestamptz not null default now(),
  primary key (deployment, chain, owner, workflow_id, revision)
);

alter table workflow_v2_inventory_cursors enable row level security;
alter table workflow_v2_authorization_events enable row level security;
alter table workflow_v2_archive_events enable row level security;

create function workflow_v2_write_archive(
  p_deployment text, p_chain integer, p_owner text, p_workflow text,
  p_revision bigint, p_epoch numeric, p_archived boolean
) returns boolean language sql volatile set search_path = public as $$
  with latest as (
    select a.revision, a.epoch, a.archived from workflow_v2_archive_events a
    where (a.deployment, a.chain, a.owner, a.workflow_id) =
      (p_deployment, p_chain, p_owner, p_workflow)
    order by a.revision desc limit 1
  ), change as (
    insert into workflow_v2_archive_events (deployment, chain, owner, workflow_id, revision, epoch, archived)
    select p_deployment, p_chain, p_owner, p_workflow, p_revision + 1, p_epoch, p_archived
    from (select 1) seed left join latest a on true
    where coalesce(a.revision, 0) = p_revision
      and coalesce(a.archived and a.epoch = p_epoch, false) <> p_archived
    on conflict do nothing returning 1
  )
  select exists (select 1 from change);
$$;

create function workflow_v2_inventory_page(
  p_deployment text, p_owner text, p_chains integer[], p_archived boolean,
  p_cursor_chain integer, p_cursor_id text, p_before boolean, p_limit integer
) returns jsonb language sql stable set search_path = public as $$
  with eligible as materialized (
    select v.chain, w.workflow_id as id
    from workflow_v2_accounts v
    cross join lateral (
      select distinct on (e.workflow_id) e.workflow_id, e.epoch
      from workflow_v2_authorization_events e
      where (e.deployment, e.chain, e.vault) = (v.deployment, v.chain, v.address)
      order by e.workflow_id, e.epoch desc
    ) w
    left join lateral (
      select a.archived, a.epoch from workflow_v2_archive_events a
      where (a.deployment, a.chain, a.owner, a.workflow_id) =
        (v.deployment, v.chain, v.owner, w.workflow_id)
      order by a.revision desc limit 1
    ) a on true
    where v.deployment = p_deployment and v.owner = p_owner and v.chain = any(p_chains)
      and coalesce(a.archived and a.epoch = w.epoch, false) = p_archived
  ), page as (
    select e.chain, e.id from eligible e
    where p_cursor_id is null
      or (p_before and (e.chain, e.id) < (p_cursor_chain, p_cursor_id))
      or (not p_before and (e.chain, e.id) > (p_cursor_chain, p_cursor_id))
    order by case when p_before then e.chain end desc, case when p_before then e.id end desc,
      e.chain, e.id
    limit p_limit
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page) order by
      case when p_before then page.chain end desc, case when p_before then page.id end desc,
      page.chain, page.id) from page), '[]'::jsonb),
    'total', (select count(*) from eligible),
    'syncing', exists (
      select 1 from unnest(p_chains) as target(chain)
      left join workflow_v2_cursors c on c.deployment = p_deployment and c.chain = target.chain
      left join workflow_v2_inventory_cursors i on i.deployment = p_deployment and i.chain = target.chain
      where c.block_number is null or i.block_number is null or i.block_number < c.block_number
    )
  );
$$;

do $$
declare
  target regprocedure;
  role_name text;
begin
  for target in select oid::regprocedure from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('workflow_v2_write_archive', 'workflow_v2_inventory_page')
  loop
    execute format('revoke all on function %s from public', target);
    for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
      execute format('revoke all on function %s from %I', target, role_name);
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', target);
    end if;
  end loop;
end;
$$;

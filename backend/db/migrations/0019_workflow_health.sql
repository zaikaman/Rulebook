-- One row per workflow with the newest run, newest successful run, and any in-flight callback.
-- The API calls this function instead of paging all of Activity to derive a health status.
create index workflow_v2_runs_health on workflow_v2_runs
  (deployment, workflow_id, lasna_block desc, id desc, chain desc);

create function workflow_v2_health(p_deployment text, p_owner text)
returns table (
  workflow_id text,
  last_run_id text,
  last_status text,
  last_reason text,
  last_expires_at bigint,
  last_path smallint,
  last_lasna_transaction text,
  last_destination_transaction text,
  last_success_id text,
  last_success_path smallint,
  last_success_lasna_transaction text,
  last_success_destination_transaction text,
  pending_run_id text,
  pending_expires_at bigint
) language sql stable set search_path = public as $$
  with latest as (
    select distinct on (workflow_id) *
    from workflow_v2_activity
    where deployment = p_deployment and owner = p_owner
    order by workflow_id, lasna_block desc, id desc, chain desc
  ),
  success as (
    select distinct on (workflow_id) *
    from workflow_v2_activity
    where deployment = p_deployment and owner = p_owner and status = 'confirmed'
    order by workflow_id, lasna_block desc, id desc, chain desc
  ),
  pending as (
    select distinct on (workflow_id) *
    from workflow_v2_activity
    where deployment = p_deployment and owner = p_owner
      and status in ('pending', 'in grace period')
    order by workflow_id, lasna_block desc, id desc, chain desc
  )
  select
    latest.workflow_id,
    latest.id,
    latest.status,
    latest.reason,
    latest.expires_at,
    latest.path,
    latest.lasna_transaction,
    latest.destination_transaction,
    success.id,
    success.path,
    success.lasna_transaction,
    success.destination_transaction,
    pending.id,
    pending.expires_at
  from latest
  left join success using (workflow_id)
  left join pending using (workflow_id);
$$;

revoke all on function workflow_v2_health(text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function workflow_v2_health(text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function workflow_v2_health(text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function workflow_v2_health(text, text) to service_role';
  end if;
end;
$$;

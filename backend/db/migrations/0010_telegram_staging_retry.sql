-- A temporary chain RPC failure should not block other staged notifications.
alter table telegram_alert_outbox add column retry_at timestamptz not null default '-infinity';

create or replace function telegram_pending_notifications()
returns table (chain_id int, tx_hash text, log_index int, agent text, rule_id text, template smallint,
    observed text, block_time timestamptz, execution jsonb, eligible boolean)
language sql stable set search_path = public as $$
  select a.chain_id, a.tx_hash, a.log_index, a.agent, a.rule_id::text, coalesce(a.template, r.template),
    a.observed::text, a.block_time, a.execution,
    a.block_time > now() - interval '1 day'
      and exists (select 1 from telegram_destination(a.agent, a.rule_id, a.block_time))
    from telegram_alert_outbox a left join rules r using (agent, rule_id)
    where a.processed_at is null and a.retry_at <= now()
    order by a.staged_at, a.chain_id, a.tx_hash, a.log_index limit 25;
$$;

create function telegram_defer_notification(p_chain int, p_tx text, p_index int)
returns void language sql set search_path = public as $$
  update telegram_alert_outbox set retry_at = now() + interval '1 minute'
    where chain_id = p_chain and tx_hash = p_tx and log_index = p_index and processed_at is null;
$$;

revoke all on function telegram_defer_notification(integer,text,integer) from public;
do $$
declare
  role_name text;
begin
  for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
    execute format('revoke all on function telegram_defer_notification(integer,text,integer) from %I', role_name);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function telegram_defer_notification(integer,text,integer) to service_role;
  end if;
end;
$$;

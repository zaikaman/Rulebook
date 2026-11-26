-- Backfill payout deliveries missing alert_data.chain and harden telegram_prepare to always
-- include delivery.chain_id in preflight payloads.

update telegram_deliveries
set alert_data = alert_data || jsonb_build_object('chain', chain_id)
where alert_kind = 'payout'
  and alert_data is not null
  and chain_id is not null
  and not (alert_data ? 'chain');

create or replace function telegram_queue_payout_warnings(p_deployment text)
returns void language sql set search_path = public as $$
  insert into telegram_deliveries (agent, connection_id, chain_id, workflow_id,
    block_time, message, alert_kind, alert_data, alert_key)
  select w.agent, a.connection_id, w.chain, w.workflow_id, clock_timestamp(), w.message, 'payout',
    jsonb_build_object('kind', 'payout', 'chain', w.chain, 'vault', w.vault,
      'workflow', w.workflow_id, 'epoch', w.epoch, 'deadline', w.deadline,
      'block', w.block_number::text, 'deployment', w.deployment),
    k.delivery_key
  from telegram_payout_windows w
  cross join lateral telegram_alert_destination(w.agent, 'payout', clock_timestamp()) a
  cross join lateral (select concat_ws(':', w.deployment, w.agent, w.workflow_id, w.epoch, w.deadline,
    a.connection_id, extract(epoch from a.enabled_since), extract(epoch from a.action_since)) as delivery_key) k
  where w.deployment = p_deployment and w.deadline > extract(epoch from now())
    and not exists (select 1 from telegram_deliveries d where d.alert_key = k.delivery_key)
  order by w.deadline limit 25 on conflict (alert_key) do nothing;
$$;

create or replace function telegram_prepare(p_id text, p_lease uuid)
returns table (chat_id text, message text, attempts int, preflight jsonb)
language plpgsql set search_path = public as $$
declare
  delivery telegram_deliveries%rowtype;
  target text;
  recipient text;
begin
  select agent into target from telegram_deliveries where id = p_id::bigint
    and status = 'sending' and lease = p_lease and due_at > now();
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(target, 8008));
  select * into delivery from telegram_deliveries where id = p_id::bigint
    and status = 'sending' and lease = p_lease and due_at > clock_timestamp() + interval '12 seconds'
    for update;
  if not found then return; end if;
  if delivery.alert_kind is not null then
    select a.chat_id into recipient from telegram_alert_destination(delivery.agent, delivery.alert_kind, delivery.block_time) a
      where a.connection_id = delivery.connection_id;
    if delivery.alert_kind = 'funding' and not exists (
      select 1 from telegram_funding_checks f where f.deployment = delivery.alert_data ->> 'deployment'
        and f.agent = delivery.agent and f.chain = delivery.chain_id and f.connection_id = delivery.connection_id
        and f.state = delivery.alert_data ->> 'state' and f.episode = (delivery.alert_data ->> 'episode')::bigint
    ) then recipient := null; end if;
    if delivery.alert_kind = 'payout' and to_timestamp((delivery.alert_data ->> 'deadline')::bigint) <= now()
      then recipient := null; end if;
    if delivery.alert_kind = 'unfinished' and exists (
      select 1 from telegram_workflow_outcomes o where o.deployment = delivery.alert_data ->> 'deployment'
        and o.chain = delivery.chain_id and o.run_id = delivery.alert_data ->> 'run'
    ) then recipient := null; end if;
  elsif delivery.workflow_id is null then
    select a.chat_id into recipient from telegram_destination(delivery.agent, delivery.rule_id, delivery.block_time) a
      where a.connection_id = delivery.connection_id;
  else
    select a.chat_id into recipient from telegram_workflow_destination(delivery.agent, delivery.workflow_id, delivery.block_time) a
      where a.connection_id = delivery.connection_id;
  end if;
  if recipient is null or delivery.attempts > (case when delivery.alert_kind = 'payout' then 32 else 12 end)
    or delivery.created_at <= now() - interval '1 day' then
    update telegram_deliveries d set status = case when recipient is null then 'cancelled' else 'failed' end, lease = null
      where d.id = delivery.id and d.lease = p_lease;
    return;
  end if;
  return query select recipient, delivery.message, delivery.attempts,
    case
      when delivery.alert_kind in ('payout', 'funding') and delivery.alert_data is not null then
        case when delivery.chain_id is not null
          then delivery.alert_data || jsonb_build_object('chain', delivery.chain_id)
          else delivery.alert_data
        end
      else null
    end;
end;
$$;

do $$
declare
  target record;
  role_name text;
begin
  for target in
    select 'function' as kind, oid::regprocedure::text as name from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('telegram_queue_payout_warnings', 'telegram_prepare')
  loop
    execute format('revoke all on %s %s from public', target.kind, target.name);
    for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
      execute format('revoke all on %s %s from %I', target.kind, target.name, role_name);
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on %s %s to service_role', target.kind, target.name);
    end if;
  end loop;
end;
$$;

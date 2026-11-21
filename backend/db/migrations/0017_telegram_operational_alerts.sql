alter table telegram_accounts
  add column funding_alerts boolean not null default true,
  add column action_alerts boolean not null default true,
  add column funding_since timestamptz not null default '-infinity',
  add column action_since timestamptz not null default '-infinity';

alter table telegram_deliveries
  add column alert_kind text check (alert_kind in ('funding', 'failed', 'expired', 'unfinished', 'payout')),
  add column alert_data jsonb,
  add column alert_key text unique;

alter table workflow_v2_outcomes add column telegram_retry_at timestamptz not null default '-infinity';
alter table workflow_v2_runs add column telegram_checked_at timestamptz;
alter table workflow_v2_cursors add column block_time timestamptz;

drop index workflow_v2_pending_telegram;
create index workflow_v2_pending_telegram on workflow_v2_outcomes (deployment, telegram_block_time)
  where status in (1, 3, 4, 6) and telegram_processed_at is null and telegram_block_time is not null;
create index workflow_v2_unchecked_runs on workflow_v2_runs (deployment, expires_at)
  where telegram_checked_at is null;
create index telegram_problem_history on telegram_deliveries (agent, workflow_id, created_at desc)
  where alert_kind in ('failed', 'expired', 'unfinished');
create index telegram_account_alert_history on telegram_deliveries (agent, connection_id, id desc)
  where alert_kind is not null;

create table telegram_payout_windows (
  deployment text not null,
  agent text not null,
  workflow_id text not null,
  epoch text not null,
  deadline bigint not null,
  chain int not null,
  vault text not null,
  block_number bigint not null,
  message text not null,
  primary key (deployment, agent, workflow_id, epoch, deadline)
);
alter table telegram_payout_windows enable row level security;
create index telegram_payout_deadline on telegram_payout_windows (deployment, deadline);

create function telegram_set_alert_preferences(p_agent text, p_funding boolean, p_action boolean)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  update telegram_accounts set funding_alerts = coalesce(p_funding, funding_alerts),
    action_alerts = coalesce(p_action, action_alerts),
    funding_since = case when p_funding is distinct from funding_alerts and p_funding is not null
      then clock_timestamp() else funding_since end,
    action_since = case when p_action is distinct from action_alerts and p_action is not null
      then clock_timestamp() else action_since end
  where agent = p_agent;
  return found;
end;
$$;

create function telegram_alert_status(p_deployment text, p_agent text, p_session text)
returns jsonb language sql stable set search_path = public as $$
  select telegram_workflow_status(p_deployment, p_agent, p_session) || jsonb_build_object(
    'fundingAlerts', coalesce(a.funding_alerts, true),
    'actionAlerts', coalesce(a.action_alerts, true),
    'lastProblemDelivery', (
      select jsonb_build_object('status', d.status, 'at', d.created_at)
      from telegram_deliveries d where d.agent = p_agent and d.connection_id = a.connection_id
        and d.alert_kind is not null and d.status in ('sent', 'failed')
      order by d.id desc limit 1
    )
  ) from (select p_agent as agent) requested left join telegram_accounts a using (agent);
$$;

create function telegram_alert_destination(p_agent text, p_kind text, p_time timestamptz)
returns setof telegram_accounts language sql stable set search_path = public as $$
  select a.* from telegram_accounts a
  where a.agent = p_agent and a.chat_id is not null and not a.blocked and a.enabled
    and p_time > a.enabled_since
    and case when p_kind = 'funding' then a.funding_alerts and p_time > a.funding_since
      else a.action_alerts and p_time > a.action_since end;
$$;

-- Factory-verified ownership and matching workflow epochs are required for every outcome.
create view telegram_workflow_outcomes with (security_invoker = true) as
  select o.*, r.agent, w.title, r.program_hash, r.origin_chain, r.origin_transaction, r.origin_log_index
  from workflow_v2_outcomes o
  join workflow_v2_accounts v on v.deployment = o.deployment and v.chain = o.chain and v.address = o.vault
  join workflow_v2_runs r on r.deployment = o.deployment and r.chain = o.chain and r.id = o.run_id
    and r.workflow_id = o.workflow_id and r.epoch = o.epoch and r.agent = v.agent
  join workflow_v2_accounts a on a.deployment = r.deployment and a.chain = 5318007
    and a.address = r.agent and a.owner = v.owner
  join workflow_v2_activations w on w.deployment = r.deployment and w.chain = r.chain
    and w.agent = r.agent and w.workflow_id = r.workflow_id and w.epoch = r.epoch and w.program_hash = r.program_hash;

create function telegram_workflow_candidates(p_deployment text, p_chain int)
returns jsonb language sql set search_path = public as $$
  with pending as materialized (
    select o.transaction_hash, o.log_index, o.block_number, o.vault, o.run_id, o.workflow_id,
      o.epoch, o.status, o.reason, o.title, o.program_hash,
      o.origin_chain, o.origin_transaction, o.origin_log_index,
      case when o.status = 6 then true when o.status = 1 then exists (
        select 1 from telegram_workflow_destination(o.agent, o.workflow_id, o.telegram_block_time)
      ) else exists (
        select 1 from telegram_alert_destination(o.agent, 'action', o.telegram_block_time)
      ) end as eligible
    from telegram_workflow_outcomes o
    join workflow_v2_outcomes source using (deployment, chain, transaction_hash, log_index)
    where o.deployment = p_deployment and o.chain = p_chain and o.status in (1, 3, 4, 6)
      and source.telegram_processed_at is null and source.telegram_retry_at <= now()
      and o.telegram_block_time > now() - interval '1 day'
    order by case when o.status = 6 then 0 when o.status = 1 then 2 else 1 end,
      o.telegram_block_time, o.block_number, o.log_index
    limit 25 for update of source skip locked
  ), leased as (
    update workflow_v2_outcomes o set telegram_retry_at = now() + interval '2 minutes'
    from pending p where (o.deployment, o.chain, o.transaction_hash, o.log_index)
      = (p_deployment, p_chain, p.transaction_hash, p.log_index)
    returning o.transaction_hash, o.log_index
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by case when p.status = 6 then 0 when p.status = 1 then 2 else 1 end,
    p.block_number, p.log_index), '[]'::jsonb)
  from pending p join leased l using (transaction_hash, log_index);
$$;

create function telegram_defer_workflow(p_deployment text, p_chain int, p_tx text, p_index int)
returns void language sql set search_path = public as $$
  update workflow_v2_outcomes set telegram_retry_at = now() + interval '1 minute'
  where (deployment, chain, transaction_hash, log_index) = (p_deployment, p_chain, p_tx, p_index)
    and telegram_processed_at is null;
$$;

create function telegram_complete_workflow(p_deployment text, p_chain int, p_tx text,
  p_index int, p_message text, p_deadline bigint)
returns void language plpgsql set search_path = public as $$
declare
  o telegram_workflow_outcomes%rowtype;
  kind text;
  metadata jsonb;
begin
  select * into o from telegram_workflow_outcomes
  where (deployment, chain, transaction_hash, log_index) = (p_deployment, p_chain, p_tx, p_index);
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(o.agent, 8008));
  update workflow_v2_outcomes set telegram_processed_at = now()
  where (deployment, chain, transaction_hash, log_index) = (p_deployment, p_chain, p_tx, p_index)
    and telegram_processed_at is null and telegram_block_time > now() - interval '1 day';
  if not found or p_message is null then return; end if;

  if o.status = 1 then
    insert into telegram_deliveries (agent, connection_id, chain_id, tx_hash, log_index, workflow_id, block_time, message)
    select o.agent, a.connection_id, p_chain, p_tx, p_index, o.workflow_id, o.telegram_block_time, p_message
    from telegram_workflow_destination(o.agent, o.workflow_id, o.telegram_block_time) a
    on conflict (chain_id, tx_hash, log_index) do nothing;
    return;
  end if;

  if o.status = 6 then
    if p_deadline is not null and to_timestamp(p_deadline) > now() then
      insert into telegram_payout_windows values (p_deployment, o.agent, o.workflow_id, o.epoch,
        p_deadline, p_chain, o.vault, o.block_number, p_message) on conflict do nothing;
    end if;
    return;
  end if;
  kind := case o.status when 3 then 'expired' when 4 then 'failed' end;
  if kind is null then return; end if;
  metadata := jsonb_build_object('reason', o.reason, 'deployment', p_deployment);
  insert into telegram_deliveries (agent, connection_id, chain_id, tx_hash, log_index, workflow_id,
    block_time, message, alert_kind, alert_data)
  select o.agent, a.connection_id, p_chain, p_tx, p_index, o.workflow_id, o.telegram_block_time,
    p_message, kind, metadata
  from telegram_alert_destination(o.agent, kind, o.telegram_block_time) a
  where (kind <> 'expired' or not exists (
    select 1 from telegram_deliveries d where d.alert_key = p_deployment || ':unfinished:' || o.run_id
      and d.connection_id = a.connection_id and d.status = 'sent'
  )) and not exists (
    select 1 from telegram_deliveries d where d.agent = o.agent and d.workflow_id = o.workflow_id
      and d.connection_id = a.connection_id and d.alert_kind = kind and d.alert_data = metadata
      and d.status in ('pending', 'sending', 'sent') and d.created_at > now() - interval '1 hour'
  )
  on conflict do nothing;
end;
$$;

create function telegram_queue_payout_warnings(p_deployment text)
returns void language sql set search_path = public as $$
  insert into telegram_deliveries (agent, connection_id, chain_id, workflow_id,
    block_time, message, alert_kind, alert_data, alert_key)
  select w.agent, a.connection_id, w.chain, w.workflow_id, clock_timestamp(), w.message, 'payout',
    jsonb_build_object('kind', 'payout', 'vault', w.vault, 'workflow', w.workflow_id,
      'epoch', w.epoch, 'deadline', w.deadline, 'block', w.block_number::text, 'deployment', w.deployment),
    k.delivery_key
  from telegram_payout_windows w
  cross join lateral telegram_alert_destination(w.agent, 'payout', clock_timestamp()) a
  cross join lateral (select concat_ws(':', w.deployment, w.agent, w.workflow_id, w.epoch, w.deadline,
    a.connection_id, extract(epoch from a.enabled_since), extract(epoch from a.action_since)) as delivery_key) k
  where w.deployment = p_deployment and w.deadline > extract(epoch from now())
    and not exists (select 1 from telegram_deliveries d where d.alert_key = k.delivery_key)
  order by w.deadline limit 25 on conflict (alert_key) do nothing;
$$;

create function telegram_process_unfinished(p_deployment text, p_chain int, p_origin text)
returns void language plpgsql set search_path = public as $$
declare
  watermark timestamptz;
  candidate record;
  recipient telegram_accounts%rowtype;
begin
  if not pg_try_advisory_xact_lock(hashtextextended(p_deployment, 8017)) then return; end if;
  delete from telegram_payout_windows where deployment = p_deployment and deadline <= extract(epoch from now());
  with old_outcomes as (
    select deployment, chain, transaction_hash, log_index from workflow_v2_outcomes
    where deployment = p_deployment and chain = p_chain and status in (1, 3, 4, 6)
      and telegram_processed_at is null and telegram_block_time <= now() - interval '1 day'
    order by telegram_block_time limit 25 for update skip locked
  )
  update workflow_v2_outcomes o set telegram_processed_at = now() from old_outcomes e
  where (o.deployment, o.chain, o.transaction_hash, o.log_index)
    = (e.deployment, e.chain, e.transaction_hash, e.log_index);
  select least(s.block_time, d.block_time) into watermark
  from workflow_v2_cursors s join workflow_v2_cursors d using (deployment)
  where s.deployment = p_deployment and s.chain = 5318007 and d.chain = p_chain
    and s.block_time is not null and d.block_time is not null;
  if watermark is null or watermark < now() - interval '10 minutes' then return; end if;
  -- Process oldest due runs first. A lagging destination index never becomes a user alert.
  for candidate in
    select r.*, w.title from workflow_v2_runs r
    join workflow_v2_activations w on w.deployment = r.deployment and w.chain = r.chain
      and w.agent = r.agent and w.workflow_id = r.workflow_id and w.epoch = r.epoch and w.program_hash = r.program_hash
    where r.deployment = p_deployment and r.chain = p_chain and r.telegram_checked_at is null
      and r.expires_at <= extract(epoch from watermark - interval '1 minute')
      and r.expires_at > extract(epoch from now() - interval '1 day')
    order by r.expires_at, r.id limit 25 for update of r skip locked
  loop
    update workflow_v2_runs set telegram_checked_at = now()
    where (deployment, chain, id) = (p_deployment, p_chain, candidate.id);
    if exists (
      select 1 from telegram_workflow_outcomes o
      where o.deployment = p_deployment and o.chain = p_chain and o.run_id = candidate.id
    ) then continue; end if;
    -- Do not hold account locks for the whole batch. Preparation rechecks the current preference.
    select * into recipient from telegram_alert_destination(candidate.agent, 'unfinished', to_timestamp(candidate.expires_at));
    if not found then continue; end if;
    insert into telegram_deliveries (agent, connection_id, chain_id, workflow_id, block_time, message,
      alert_kind, alert_data, alert_key)
    select candidate.agent, recipient.connection_id, p_chain, candidate.workflow_id, to_timestamp(candidate.expires_at),
      concat_ws(E'\n', 'Rulebook · Run could not be confirmed', candidate.title,
        'The run reached its deadline without a confirmed result. Open the run to check what happened.',
        p_origin || '/runs/' || candidate.id),
      'unfinished', jsonb_build_object('deployment', p_deployment, 'run', candidate.id, 'chain', p_chain),
      p_deployment || ':unfinished:' || candidate.id
    where not exists (
      select 1 from telegram_deliveries d where d.agent = candidate.agent and d.workflow_id = candidate.workflow_id
        and d.connection_id = recipient.connection_id and d.alert_kind = 'unfinished'
        and d.status in ('pending', 'sending', 'sent') and d.created_at > now() - interval '1 hour'
    ) on conflict do nothing;
  end loop;
end;
$$;

create table telegram_funding_checks (
  deployment text not null,
  agent text not null references telegram_accounts (agent) on delete cascade,
  chain int not null,
  created_at timestamptz not null default now(),
  due_at timestamptz not null default '-infinity',
  lease uuid,
  lease_until timestamptz,
  block_number bigint,
  checked_at timestamptz,
  state text check (state in ('inactive', 'healthy', 'low', 'empty', 'debt')),
  connection_id uuid,
  enabled_since timestamptz,
  funding_since timestamptz,
  episode bigint not null default 0,
  warned boolean not null default false,
  warned_urgent boolean not null default false,
  recovery_pending boolean not null default false,
  primary key (deployment, agent, chain)
);
alter table telegram_funding_checks enable row level security;
create index telegram_funding_due on telegram_funding_checks (deployment, chain, due_at);
create index telegram_funding_activated on workflow_v2_activations (deployment, agent);

create function telegram_claim_funding(p_deployment text, p_chain int, p_limit int)
returns jsonb language plpgsql set search_path = public as $$
declare
  result jsonb;
begin
  -- Seed a bounded number of jobs. The joins only use accounts from the configured factories.
  insert into telegram_funding_checks (deployment, agent, chain)
  select p_deployment, a.agent, p_chain
  from telegram_accounts a
  join workflow_v2_accounts w on w.deployment = p_deployment and w.chain = 5318007 and w.address = a.agent
  where a.chat_id is not null and not a.blocked and a.enabled and a.funding_alerts
    and (p_chain = 5318007 or exists (select 1 from workflow_v2_accounts v
      where v.deployment = p_deployment and v.chain = p_chain and v.owner = w.owner and v.agent = w.address))
    and exists (select 1 from workflow_v2_activations e where e.deployment = p_deployment and e.agent = a.agent)
    and not exists (select 1 from telegram_funding_checks f where f.deployment = p_deployment
      and f.agent = a.agent and f.chain = p_chain)
  order by a.agent limit p_limit on conflict do nothing;
  with candidates as (
    select f.deployment, f.agent, f.chain, v.address as vault
    from telegram_funding_checks f join telegram_accounts a using (agent)
    join workflow_v2_accounts w on w.deployment = f.deployment and w.chain = 5318007 and w.address = f.agent
    left join workflow_v2_accounts v on v.deployment = f.deployment and v.chain = 1301
      and v.owner = w.owner and v.agent = w.address
    where f.deployment = p_deployment and f.chain = p_chain and f.due_at <= now()
      and a.chat_id is not null and not a.blocked and a.enabled and a.funding_alerts
      and (p_chain = 5318007 or v.address is not null)
    order by f.due_at, f.agent limit p_limit for update of f skip locked
  ), leased as (
    update telegram_funding_checks f set lease = gen_random_uuid(), lease_until = now() + interval '2 minutes',
      due_at = now() + interval '2 minutes'
    from candidates c where (f.deployment, f.agent, f.chain) = (c.deployment, c.agent, c.chain)
    returning f.agent, f.lease, c.vault
  ) select coalesce(jsonb_agg(to_jsonb(leased)), '[]'::jsonb) into result from leased;
  return result;
end;
$$;

create function telegram_record_funding(p_deployment text, p_agent text, p_chain int, p_lease uuid,
  p_block bigint, p_state text, p_message text, p_recovery text)
returns void language plpgsql set search_path = public as $$
declare
  previous telegram_funding_checks%rowtype;
  recipient telegram_accounts%rowtype;
  previous_state text;
  message text;
  beneficiary text;
  episode_number bigint;
  episode_warned boolean;
  urgent_warning_sent boolean;
  recovering boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  select * into previous from telegram_funding_checks
  where (deployment, agent, chain) = (p_deployment, p_agent, p_chain) and lease = p_lease
    and lease_until > now() for update;
  if not found then return; end if;
  select * into recipient from telegram_alert_destination(p_agent, 'funding', clock_timestamp());
  if not found or p_block < previous.block_number then return; end if;
  if previous.connection_id = recipient.connection_id and previous.enabled_since = recipient.enabled_since
    and previous.funding_since = recipient.funding_since then
    previous_state := previous.state;
  end if;
  episode_number := previous.episode;
  episode_warned := previous.warned;
  urgent_warning_sent := previous.warned_urgent;
  if previous_state is null or previous_state = 'inactive'
    or (previous_state = 'healthy' and p_state <> 'healthy') then
    episode_number := episode_number + 1;
    episode_warned := false;
    urgent_warning_sent := false;
  end if;
  recovering := p_state = 'healthy' and (
    coalesce(previous_state in ('low', 'empty', 'debt'), false)
    or (previous_state is not distinct from 'healthy' and previous.recovery_pending)
  );
  update telegram_funding_checks set state = p_state, block_number = p_block, checked_at = now(),
    due_at = now() + case when p_state = 'inactive' then interval '5 minutes' else interval '2 minutes' end,
    lease = null, lease_until = null,
    connection_id = recipient.connection_id, enabled_since = recipient.enabled_since, funding_since = recipient.funding_since,
    episode = episode_number, warned = episode_warned, warned_urgent = urgent_warning_sent,
    recovery_pending = recovering and not episode_warned
  where (deployment, agent, chain) = (p_deployment, p_agent, p_chain);

  if p_state in ('low', 'empty', 'debt') and (p_state <> 'low' or not urgent_warning_sent)
    and not exists (
      select 1 from telegram_deliveries d where d.agent = p_agent and d.chain_id = p_chain
        and d.connection_id = recipient.connection_id and d.alert_kind = 'funding' and d.status <> 'cancelled'
        and d.alert_data @> jsonb_build_object('deployment', p_deployment, 'state', p_state, 'episode', episode_number)
    ) then
    message := p_message;
  elsif recovering and episode_warned then
    message := p_recovery;
  end if;
  if message is null then return; end if;
  select case when p_chain = 5318007 then p_agent else v.address end into beneficiary
  from workflow_v2_accounts w
  left join workflow_v2_accounts v on v.deployment = w.deployment and v.chain = p_chain
    and v.agent = w.address and v.owner = w.owner
  where w.deployment = p_deployment and w.chain = 5318007 and w.address = p_agent;
  if beneficiary is null then return; end if;
  insert into telegram_deliveries (agent, connection_id, chain_id, block_time, message, alert_kind, alert_data)
  values (p_agent, recipient.connection_id, p_chain, clock_timestamp(), message, 'funding',
    jsonb_build_object('kind', 'funding', 'deployment', p_deployment, 'chain', p_chain, 'state', p_state,
      'beneficiary', beneficiary, 'episode', episode_number, 'block', p_block::text));
end;
$$;

-- Old processes can keep sending their usual messages during a rolling deploy.
create or replace function telegram_claim()
returns table (id text, lease uuid) language sql set search_path = public as $$
  update telegram_deliveries d set status = 'sending', attempts = attempts + 1,
    lease = gen_random_uuid(), due_at = now() + interval '60 seconds'
  where d.id = (select j.id from telegram_deliveries j
    where j.alert_kind is null and j.status in ('pending', 'sending') and j.due_at <= now()
    order by j.due_at, j.id limit 1 for update skip locked)
  returning d.id::text, d.lease;
$$;

create index telegram_payout_due on telegram_deliveries ((alert_data ->> 'deployment'), due_at, id)
  where alert_kind = 'payout' and status in ('pending', 'sending');
create function telegram_claim_alert_delivery(p_deployment text)
returns table (id text, lease uuid) language sql set search_path = public as $$
  with urgent as (
    select j.id from telegram_deliveries j where j.alert_kind = 'payout'
      and j.alert_data ->> 'deployment' = p_deployment
      and j.status in ('pending', 'sending') and j.due_at <= now()
    order by j.due_at, j.id limit 1 for update skip locked
  ), ordinary as (
    select j.id from telegram_deliveries j where not exists (select 1 from urgent)
      and (j.alert_kind is null or j.alert_data ->> 'deployment' = p_deployment)
      and j.status in ('pending', 'sending') and j.due_at <= now()
    order by j.due_at, j.id limit 1 for update skip locked
  )
  update telegram_deliveries d set status = 'sending', attempts = attempts + 1,
    lease = gen_random_uuid(), due_at = now() + interval '60 seconds'
  where d.id = coalesce((select urgent.id from urgent), (select ordinary.id from ordinary))
  returning d.id::text, d.lease;
$$;

drop function telegram_prepare(text, uuid);
create function telegram_prepare(p_id text, p_lease uuid)
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
    case when delivery.alert_kind in ('payout', 'funding') then delivery.alert_data else null end;
end;
$$;

create or replace function telegram_finish(p_id text, p_lease uuid, p_result text, p_delay int)
returns void language plpgsql set search_path = public as $$
declare
  target text;
  delivery telegram_deliveries%rowtype;
begin
  select agent into target from telegram_deliveries where id = p_id::bigint and lease = p_lease;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(target, 8008));
  update telegram_deliveries set status = case when p_result = 'retry' then 'pending'
      when p_result in ('sent', 'cancelled') then p_result else 'failed' end,
    due_at = now() + make_interval(secs => p_delay), lease = null
    where id = p_id::bigint and lease = p_lease returning * into delivery;
  if p_result = 'blocked' and found then
    update telegram_accounts set blocked = true where agent = target and connection_id = delivery.connection_id;
  elsif p_result = 'sent' and delivery.alert_kind = 'funding' and delivery.alert_data ->> 'state' <> 'healthy' then
    update telegram_funding_checks set warned = true,
      warned_urgent = warned_urgent or delivery.alert_data ->> 'state' in ('empty', 'debt')
    where deployment = delivery.alert_data ->> 'deployment'
      and agent = target and chain = delivery.chain_id and connection_id = delivery.connection_id
      and episode = (delivery.alert_data ->> 'episode')::bigint;
  end if;
end;
$$;

create function telegram_operational_metrics(p_deployment text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'overdueFundingChecks', (select count(*) from telegram_funding_checks f
      join telegram_accounts a using (agent) where f.deployment = p_deployment
      and a.enabled and a.funding_alerts and not a.blocked and a.chat_id is not null
      and coalesce(f.checked_at, f.created_at) < now() -
        case when f.state = 'inactive' then interval '10 minutes' else interval '5 minutes' end),
    'pendingWorkflowAlerts', (select count(*) from workflow_v2_outcomes o where o.deployment = p_deployment
      and o.status in (1, 3, 4, 6) and o.telegram_processed_at is null
      and o.telegram_block_time > now() - interval '1 day'),
    'oldestWorkflowSeconds', (select coalesce(extract(epoch from now() - min(o.telegram_block_time)), 0)
      from workflow_v2_outcomes o where o.deployment = p_deployment
      and o.status in (1, 3, 4, 6) and o.telegram_processed_at is null
      and o.telegram_block_time > now() - interval '1 day')
  );
$$;

create function telegram_operational_ready()
returns boolean language sql stable set search_path = public as $$
  select telegram_workflows_ready()
    and has_table_privilege('telegram_funding_checks', 'SELECT')
    and has_table_privilege('telegram_funding_checks', 'INSERT')
    and has_table_privilege('telegram_funding_checks', 'UPDATE')
    and has_table_privilege('telegram_workflow_outcomes', 'SELECT')
    and has_table_privilege('telegram_payout_windows', 'SELECT')
    and has_table_privilege('telegram_payout_windows', 'INSERT')
    and has_table_privilege('telegram_payout_windows', 'DELETE')
    and has_function_privilege('telegram_prepare(text,uuid)', 'EXECUTE')
    and has_function_privilege('telegram_claim_alert_delivery(text)', 'EXECUTE')
    and has_function_privilege('telegram_set_alert_preferences(text,boolean,boolean)', 'EXECUTE')
    and has_function_privilege('telegram_alert_status(text,text,text)', 'EXECUTE')
    and has_function_privilege('telegram_workflow_candidates(text,integer)', 'EXECUTE')
    and has_function_privilege('telegram_defer_workflow(text,integer,text,integer)', 'EXECUTE')
    and has_function_privilege('telegram_complete_workflow(text,integer,text,integer,text,bigint)', 'EXECUTE')
    and has_function_privilege('telegram_process_unfinished(text,integer,text)', 'EXECUTE')
    and has_function_privilege('telegram_queue_payout_warnings(text)', 'EXECUTE')
    and has_function_privilege('telegram_claim_funding(text,integer,integer)', 'EXECUTE')
    and has_function_privilege('telegram_record_funding(text,text,integer,uuid,bigint,text,text,text)', 'EXECUTE');
$$;

do $$
declare
  target record;
  role_name text;
begin
  for target in
    select 'table' as kind, 'telegram_funding_checks' as name
    union all select 'table', 'telegram_workflow_outcomes'
    union all select 'table', 'telegram_payout_windows'
    union all select 'function', oid::regprocedure::text from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('telegram_set_alert_preferences', 'telegram_alert_status', 'telegram_alert_destination',
        'telegram_workflow_candidates', 'telegram_defer_workflow', 'telegram_complete_workflow',
        'telegram_process_unfinished', 'telegram_queue_payout_warnings', 'telegram_claim_funding', 'telegram_record_funding',
        'telegram_claim_alert_delivery', 'telegram_prepare', 'telegram_operational_metrics', 'telegram_operational_ready')
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

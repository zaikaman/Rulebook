-- Support Reactive Mainnet (1597), Unichain Mainnet (130), and Base Mainnet (8453) alongside
-- Reactive Lasna (5318007), Unichain Sepolia (1301), and Base Sepolia (84532).

create or replace view workflow_v2_activity with (security_invoker = true) as
select
  r.deployment,
  r.chain,
  r.id,
  r.agent,
  r.workflow_id,
  r.program_hash,
  r.epoch,
  r.origin_chain,
  r.origin_transaction,
  r.origin_log_index,
  r.lasna_transaction,
  r.lasna_block,
  r.expires_at,
  a.owner, w.title, o.transaction_hash as destination_transaction, o.path,
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
join workflow_v2_accounts a on a.deployment = r.deployment
  and a.chain = case when r.chain in (130, 8453) then 1597 else 5318007 end
  and a.address = r.agent
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

create or replace view telegram_workflow_outcomes with (security_invoker = true) as
  select o.*, r.agent, w.title, r.program_hash, r.origin_chain, r.origin_transaction, r.origin_log_index
  from workflow_v2_outcomes o
  join workflow_v2_accounts v on v.deployment = o.deployment and v.chain = o.chain and v.address = o.vault
  join workflow_v2_runs r on r.deployment = o.deployment and r.chain = o.chain and r.id = o.run_id
    and r.workflow_id = o.workflow_id and r.epoch = o.epoch and r.agent = v.agent
  join workflow_v2_accounts a on a.deployment = r.deployment
    and a.chain = case when o.chain in (130, 8453) then 1597 else 5318007 end
    and a.address = r.agent and a.owner = v.owner
  join workflow_v2_activations w on w.deployment = r.deployment and w.chain = r.chain
    and w.agent = r.agent and w.workflow_id = r.workflow_id and w.epoch = r.epoch and w.program_hash = r.program_hash;

create or replace function telegram_process_workflow_notifications(
  p_deployment text, p_chain int, p_origin text, p_explorer text
)
returns void language sql set search_path = public as $$
  with candidates as materialized (
    select o.deployment, o.chain, o.transaction_hash, o.log_index, o.telegram_block_time,
      o.workflow_id, r.agent, r.id as run_id, w.title
    from workflow_v2_outcomes o
    join workflow_v2_accounts v on v.deployment = o.deployment and v.chain = o.chain and v.address = o.vault
    join workflow_v2_runs r on r.deployment = o.deployment and r.chain = o.chain and r.id = o.run_id
      and r.workflow_id = o.workflow_id and r.epoch = o.epoch and r.agent = v.agent
    join workflow_v2_accounts a on a.deployment = r.deployment
      and a.chain = case when o.chain in (130, 8453) then 1597 else 5318007 end
      and a.address = r.agent and a.owner = v.owner
    join workflow_v2_activations w on w.deployment = r.deployment and w.chain = r.chain
      and w.agent = r.agent and w.workflow_id = r.workflow_id and w.epoch = r.epoch and w.program_hash = r.program_hash
    where o.deployment = p_deployment and o.chain = p_chain and o.status = 1
      and o.telegram_processed_at is null and o.telegram_block_time > now() - interval '1 day'
    order by o.telegram_block_time, o.block_number, o.log_index
    limit 25 for update of o skip locked
  ), expired as (
    select deployment, chain, transaction_hash, log_index from workflow_v2_outcomes
    where deployment = p_deployment and chain = p_chain and status = 1
      and telegram_processed_at is null and telegram_block_time <= now() - interval '1 day'
    order by telegram_block_time limit 25 for update skip locked
  ), cleared as (
    update workflow_v2_outcomes o set telegram_processed_at = now() from expired e
    where (o.deployment, o.chain, o.transaction_hash, o.log_index)
      = (e.deployment, e.chain, e.transaction_hash, e.log_index)
  ), handled as (
    update workflow_v2_outcomes o set telegram_processed_at = now() from candidates c
    where (o.deployment, o.chain, o.transaction_hash, o.log_index)
      = (c.deployment, c.chain, c.transaction_hash, c.log_index)
    returning o.deployment, o.chain, o.transaction_hash, o.log_index
  )
  insert into telegram_deliveries (agent, connection_id, chain_id, tx_hash, log_index, workflow_id, block_time, message)
  select c.agent, a.connection_id, c.chain, c.transaction_hash, c.log_index, c.workflow_id,
    c.telegram_block_time, concat_ws(E'\n',
      'Rulebook · Workflow confirmed', c.title, p_origin || '/runs/' || c.run_id,
      p_explorer || '/tx/' || c.transaction_hash)
  from candidates c join handled h using (deployment, chain, transaction_hash, log_index)
  cross join lateral telegram_workflow_destination(c.agent, c.workflow_id, c.telegram_block_time) a
  on conflict (chain_id, tx_hash, log_index) do nothing;
$$;

create or replace function telegram_process_unfinished(p_deployment text, p_chain int, p_origin text)
returns void language plpgsql set search_path = public as $$
declare
  watermark timestamptz;
  candidate record;
  recipient telegram_accounts%rowtype;
  auto_chain int;
begin
  if not pg_try_advisory_xact_lock(hashtextextended(p_deployment, 8017)) then return; end if;
  auto_chain := case when p_chain in (130, 8453, 1597) then 1597 else 5318007 end;
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
  where s.deployment = p_deployment and s.chain = auto_chain and d.chain = p_chain
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

create or replace function telegram_claim_funding(p_deployment text, p_chain int, p_limit int)
returns jsonb language plpgsql set search_path = public as $$
declare
  result jsonb;
  auto_chain int;
begin
  auto_chain := case when p_chain in (130, 8453, 1597) then 1597 else 5318007 end;
  -- Seed a bounded number of jobs. The joins only use accounts from the configured factories.
  insert into telegram_funding_checks (deployment, agent, chain)
  select p_deployment, a.agent, p_chain
  from telegram_accounts a
  join workflow_v2_accounts w on w.deployment = p_deployment and w.chain = auto_chain and w.address = a.agent
  where a.chat_id is not null and not a.blocked and a.enabled and a.funding_alerts
    and (p_chain = auto_chain or exists (select 1 from workflow_v2_accounts v
      where v.deployment = p_deployment and v.chain = p_chain and v.owner = w.owner and v.agent = w.address))
    and exists (select 1 from workflow_v2_activations e where e.deployment = p_deployment and e.agent = a.agent)
    and not exists (select 1 from telegram_funding_checks f where f.deployment = p_deployment
      and f.agent = a.agent and f.chain = p_chain)
  order by a.agent limit p_limit on conflict do nothing;
  with candidates as (
    select f.deployment, f.agent, f.chain, v.address as vault
    from telegram_funding_checks f join telegram_accounts a using (agent)
    join workflow_v2_accounts w on w.deployment = f.deployment and w.chain = auto_chain and w.address = f.agent
    left join workflow_v2_accounts v on v.deployment = f.deployment and v.chain = p_chain
      and v.owner = w.owner and v.agent = w.address
    where f.deployment = p_deployment and f.chain = p_chain and f.due_at <= now()
      and a.chat_id is not null and not a.blocked and a.enabled and a.funding_alerts
      and (p_chain = auto_chain or v.address is not null)
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

create or replace function telegram_record_funding(p_deployment text, p_agent text, p_chain int, p_lease uuid,
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
  auto_chain int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  auto_chain := case when p_chain in (130, 8453, 1597) then 1597 else 5318007 end;
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
  select case when p_chain = auto_chain then p_agent else v.address end into beneficiary
  from workflow_v2_accounts w
  left join workflow_v2_accounts v on v.deployment = w.deployment and v.chain = p_chain
    and v.agent = w.address and v.owner = w.owner
  where w.deployment = p_deployment and w.chain = auto_chain and w.address = p_agent;
  if beneficiary is null then return; end if;
  insert into telegram_deliveries (agent, connection_id, chain_id, block_time, message, alert_kind, alert_data)
  values (p_agent, recipient.connection_id, p_chain, clock_timestamp(), message, 'funding',
    jsonb_build_object('kind', 'funding', 'deployment', p_deployment, 'chain', p_chain, 'state', p_state,
      'beneficiary', beneficiary, 'episode', episode_number, 'block', p_block::text));
end;
$$;

do $$
declare
  target record;
  role_name text;
begin
  for target in
    select 'table' as kind, 'workflow_v2_activity' as name
    union all select 'table', 'telegram_workflow_outcomes'
    union all select 'function', oid::regprocedure::text from pg_proc where pronamespace = 'public'::regnamespace
      and proname in (
        'telegram_process_workflow_notifications',
        'telegram_process_unfinished',
        'telegram_claim_funding',
        'telegram_record_funding'
      )
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

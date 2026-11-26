-- Append ?network=mainnet to Mainnet Telegram alert deep links so opening a Mainnet
-- notification in a fresh or Testnet-mode browser routes straight to Mainnet.

create or replace function telegram_process_workflow_notifications(
  p_deployment text, p_chain int, p_origin text, p_explorer text
)
returns void language sql set search_path = public as $$
  with candidates as materialized (
    select o.deployment, o.chain, o.transaction_hash, o.log_index, o.telegram_block_time,
      o.workflow_id, r.agent, r.id as run_id, w.title,
      case when o.chain in (130, 8453, 1597) then 1597 else 5318007 end as auto_chain
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
  insert into telegram_deliveries (
    automation_chain, agent, connection_id, chain_id, tx_hash, log_index, workflow_id, block_time, message
  )
  select c.auto_chain, c.agent, a.connection_id, c.chain, c.transaction_hash, c.log_index, c.workflow_id,
    c.telegram_block_time, concat_ws(E'\n',
      'Rulebook · Workflow confirmed', c.title,
      p_origin || '/runs/' || c.run_id || case when c.auto_chain = 1597 then '?network=mainnet' else '' end,
      p_explorer || '/tx/' || c.transaction_hash)
  from candidates c join handled h using (deployment, chain, transaction_hash, log_index)
  cross join lateral telegram_workflow_destination(c.agent, c.workflow_id, c.telegram_block_time, c.auto_chain) a
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
    select * into recipient
    from telegram_alert_destination(candidate.agent, 'unfinished', to_timestamp(candidate.expires_at), auto_chain);
    if not found then continue; end if;
    insert into telegram_deliveries (
      automation_chain, agent, connection_id, chain_id, workflow_id, block_time, message,
      alert_kind, alert_data, alert_key
    )
    select auto_chain, candidate.agent, recipient.connection_id, p_chain, candidate.workflow_id,
      to_timestamp(candidate.expires_at),
      concat_ws(E'\n', 'Rulebook · Run could not be confirmed', candidate.title,
        'The run reached its deadline without a confirmed result. Open the run to check what happened.',
        p_origin || '/runs/' || candidate.id || case when auto_chain = 1597 then '?network=mainnet' else '' end),
      'unfinished', jsonb_build_object('deployment', p_deployment, 'run', candidate.id, 'chain', p_chain),
      p_deployment || ':unfinished:' || candidate.id
    where not exists (
      select 1 from telegram_deliveries d
      where d.automation_chain = auto_chain and d.agent = candidate.agent and d.workflow_id = candidate.workflow_id
        and d.connection_id = recipient.connection_id and d.alert_kind = 'unfinished'
        and d.status in ('pending', 'sending', 'sent') and d.created_at > now() - interval '1 hour'
    ) on conflict do nothing;
  end loop;
end;
$$;

do $$
declare
  target record;
  role_name text;
begin
  for target in
    select 'function' as kind, oid::regprocedure::text as name from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('telegram_process_workflow_notifications', 'telegram_process_unfinished')
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

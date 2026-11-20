alter table workflow_v2_outcomes
  add column telegram_block_time timestamptz,
  add column telegram_processed_at timestamptz;

create index workflow_v2_pending_telegram on workflow_v2_outcomes
  (deployment, chain, telegram_block_time)
  where status = 1 and telegram_processed_at is null and telegram_block_time is not null;

alter table telegram_deliveries add column workflow_id text;
drop index telegram_deliveries_test_idx;
create index telegram_deliveries_test_idx on telegram_deliveries (agent, connection_id, id desc)
  where chain_id is null;

create table telegram_workflow_preferences (
  agent text not null references telegram_accounts (agent),
  workflow_id text not null check (workflow_id ~ '^0x[0-9a-f]{64}$'),
  preference text not null check (preference in ('inherit', 'send', 'mute')),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (agent, workflow_id)
);
alter table telegram_workflow_preferences enable row level security;

create function telegram_set_workflow_preference(
  p_deployment text, p_agent text, p_workflow text, p_preference text
)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  if not exists (select 1 from workflow_v2_activations
    where deployment = p_deployment and agent = p_agent and workflow_id = p_workflow)
  then return false; end if;
  insert into telegram_workflow_preferences (agent, workflow_id, preference)
    select p_agent, p_workflow, p_preference from telegram_accounts where agent = p_agent
    on conflict (agent, workflow_id) do update
      set preference = excluded.preference, changed_at = clock_timestamp()
      where telegram_workflow_preferences.preference is distinct from excluded.preference;
  return exists (select 1 from telegram_accounts where agent = p_agent);
end;
$$;

create or replace function telegram_status(p_agent text, p_session text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'connection', case when a.blocked then 'blocked' when a.chat_id is not null then 'connected' else 'disconnected' end,
    'profile', a.profile, 'configured', a.agent is not null,
    'enabled', coalesce(a.enabled, true), 'defaultMode', coalesce(a.default_mode, 'all'),
    'pendingPairing', (select jsonb_build_object('id', token_hash, 'profile', profile)
      from telegram_pairings where agent = p_agent and session_hash = p_session
      and expires_at > now() and chat_id is not null),
    'testDelivery', (select case when status in ('pending', 'sending') then 'pending'
      when status = 'sent' then 'sent' else 'failed' end from telegram_deliveries
      where agent = p_agent and connection_id = a.connection_id and chain_id is null order by id desc limit 1),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('id', r.rule_id::text, 'template', r.template,
        'preference', coalesce(p.preference, 'inherit')) order by r.rule_id)
      from rules r left join telegram_rule_preferences p using (agent, rule_id)
      where r.agent = p_agent and r.template in (11, 12, 13) and r.status <> 'cancelled'), '[]'::jsonb)
  ) from (select p_agent as agent) requested left join telegram_accounts a using (agent);
$$;

create function telegram_workflow_status(p_deployment text, p_agent text, p_session text)
returns jsonb language sql stable set search_path = public as $$
  select telegram_notification_status(p_agent, p_session) || jsonb_build_object('workflows', coalesce((
    select jsonb_agg(jsonb_build_object('id', w.workflow_id, 'title', w.title,
      'preference', coalesce(p.preference, 'inherit')) order by w.title, w.workflow_id)
    from (
      select distinct on (workflow_id) workflow_id, title from workflow_v2_activations
        where deployment = p_deployment and agent = p_agent
        order by workflow_id, epoch::numeric desc
    ) w left join telegram_workflow_preferences p on p.agent = p_agent and p.workflow_id = w.workflow_id
  ), '[]'::jsonb));
$$;

create function telegram_workflow_destination(p_agent text, p_workflow text, p_time timestamptz)
returns setof telegram_accounts language sql stable set search_path = public as $$
  select a.* from telegram_accounts a
    left join telegram_workflow_preferences p on p.agent = a.agent and p.workflow_id = p_workflow
    where a.agent = p_agent and a.chat_id is not null and not a.blocked and a.enabled
      and p_time > a.enabled_since and p_time > coalesce(p.changed_at, '-infinity')
      and (p.preference = 'send' or (coalesce(p.preference, 'inherit') = 'inherit'
        and a.default_mode = 'all' and p_time > a.defaults_since));
$$;

create function telegram_process_workflow_notifications(
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
    join workflow_v2_accounts a on a.deployment = r.deployment and a.chain = 5318007
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

create or replace function telegram_enqueue(p_agent text, p_chain int, p_tx text, p_index int,
    p_rule text, p_time timestamptz, p_message text)
returns boolean language plpgsql set search_path = public as $$
declare
  enqueued boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  if p_rule is null and exists (select 1 from telegram_deliveries d join telegram_accounts a
      on a.connection_id = d.connection_id where d.agent = p_agent and d.chain_id is null
      and d.created_at > now() - interval '1 minute') then return false; end if;
  insert into telegram_deliveries (agent, connection_id, chain_id, tx_hash, log_index, rule_id, block_time, message)
    select p_agent, connection_id, p_chain, p_tx, p_index, p_rule::numeric, p_time, p_message
    from telegram_destination(p_agent, p_rule::numeric, p_time)
    where p_message is not null and (p_rule is null or p_time > now() - interval '1 day')
    on conflict (chain_id, tx_hash, log_index) do nothing;
  enqueued := found;
  if p_rule is not null then
    update telegram_alert_outbox set processed_at = now() where chain_id = p_chain
      and tx_hash = p_tx and log_index = p_index and processed_at is null;
  end if;
  return enqueued;
end;
$$;

create or replace function telegram_prepare(p_id text, p_lease uuid)
returns table (chat_id text, message text, attempts int) language plpgsql set search_path = public as $$
declare
  delivery telegram_deliveries%rowtype;
  recipient text;
begin
  select * into delivery from telegram_deliveries where id = p_id::bigint
    and status = 'sending' and lease = p_lease and due_at > now();
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(delivery.agent, 8008));
  if delivery.workflow_id is null then
    select a.chat_id into recipient from telegram_destination(delivery.agent, delivery.rule_id, delivery.block_time) a
      where a.connection_id = delivery.connection_id;
  else
    select a.chat_id into recipient from telegram_workflow_destination(delivery.agent, delivery.workflow_id, delivery.block_time) a
      where a.connection_id = delivery.connection_id;
  end if;
  if recipient is null or delivery.attempts > 12 or delivery.created_at <= now() - interval '1 day' then
    update telegram_deliveries d set status = case when recipient is null then 'cancelled' else 'failed' end, lease = null
      where d.id = delivery.id and d.lease = p_lease;
    return;
  end if;
  return query select recipient, delivery.message, delivery.attempts;
end;
$$;

create function telegram_workflows_ready()
returns boolean language sql stable set search_path = public as $$
  select telegram_notifications_ready()
    and has_table_privilege('telegram_workflow_preferences', 'SELECT')
    and has_table_privilege('telegram_workflow_preferences', 'INSERT')
    and has_table_privilege('telegram_workflow_preferences', 'UPDATE')
    and has_function_privilege('telegram_workflow_status(text,text,text)', 'EXECUTE')
    and has_function_privilege('telegram_set_workflow_preference(text,text,text,text)', 'EXECUTE')
    and has_function_privilege('telegram_process_workflow_notifications(text,int,text,text)', 'EXECUTE');
$$;

do $$
declare
  target record;
  role_name text;
begin
  for target in
    select 'table' as kind, 'telegram_workflow_preferences' as name
    union all
    select 'function', oid::regprocedure::text from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('telegram_workflows_ready',
        'telegram_workflow_status', 'telegram_set_workflow_preference',
        'telegram_workflow_destination', 'telegram_process_workflow_notifications')
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

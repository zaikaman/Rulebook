-- Namespace Workflow V2 deployment keys by automation chain and scope all Telegram
-- accounts, sessions, pairings, preferences, deliveries, and funding checks by automation_chain
-- so identical factory or agent addresses on Reactive Lasna (5318007) and Reactive Mainnet (1597)
-- can never collide or leak across environments.

-- 1. Namespace existing bare 0x<40-hex> deployment keys using each row's chain.
-- Conflict-safe when a running indexer/worker already wrote namespaced rows alongside bare rows.
insert into workflow_v2_cursors (deployment, chain, block_number, block_time)
select
  (case when chain in (1597, 130, 8453) then '1597:' else '5318007:' end) || lower(deployment),
  chain,
  block_number,
  block_time
from workflow_v2_cursors
where deployment ~ '^0x[0-9a-fA-F]{40}$'
on conflict (deployment, chain) do update set
  block_number = greatest(workflow_v2_cursors.block_number, excluded.block_number),
  block_time = coalesce(
    greatest(workflow_v2_cursors.block_time, excluded.block_time),
    workflow_v2_cursors.block_time,
    excluded.block_time
  );
delete from workflow_v2_cursors where deployment ~ '^0x[0-9a-fA-F]{40}$';

insert into workflow_v2_accounts (deployment, chain, address, owner, agent)
select
  (case when chain in (1597, 130, 8453) then '1597:' else '5318007:' end) || lower(deployment),
  chain,
  address,
  owner,
  agent
from workflow_v2_accounts
where deployment ~ '^0x[0-9a-fA-F]{40}$'
on conflict do nothing;
delete from workflow_v2_accounts where deployment ~ '^0x[0-9a-fA-F]{40}$';

insert into workflow_v2_activations (deployment, chain, agent, workflow_id, epoch, program_hash, title)
select
  (case when chain in (1597, 130, 8453) then '1597:' else '5318007:' end) || lower(deployment),
  chain,
  agent,
  workflow_id,
  epoch,
  program_hash,
  title
from workflow_v2_activations
where deployment ~ '^0x[0-9a-fA-F]{40}$'
on conflict (deployment, chain, agent, workflow_id, epoch) do nothing;
delete from workflow_v2_activations where deployment ~ '^0x[0-9a-fA-F]{40}$';

insert into workflow_v2_runs (
  deployment, chain, id, agent, workflow_id, program_hash, epoch,
  origin_chain, origin_transaction, origin_log_index, lasna_transaction, lasna_block,
  expires_at, telegram_checked_at
)
select
  (case when chain in (1597, 130, 8453) then '1597:' else '5318007:' end) || lower(deployment),
  chain,
  id,
  agent,
  workflow_id,
  program_hash,
  epoch,
  origin_chain,
  origin_transaction,
  origin_log_index,
  lasna_transaction,
  lasna_block,
  expires_at,
  telegram_checked_at
from workflow_v2_runs
where deployment ~ '^0x[0-9a-fA-F]{40}$'
on conflict (deployment, chain, id) do update set
  telegram_checked_at = coalesce(workflow_v2_runs.telegram_checked_at, excluded.telegram_checked_at);
delete from workflow_v2_runs where deployment ~ '^0x[0-9a-fA-F]{40}$';

insert into workflow_v2_outcomes (
  deployment, chain, run_id, workflow_id, vault, epoch, transaction_hash, block_number,
  log_index, status, reason, path, telegram_block_time, telegram_processed_at, telegram_retry_at
)
select
  (case when chain in (1597, 130, 8453) then '1597:' else '5318007:' end) || lower(deployment),
  chain,
  run_id,
  workflow_id,
  vault,
  epoch,
  transaction_hash,
  block_number,
  log_index,
  status,
  reason,
  path,
  telegram_block_time,
  telegram_processed_at,
  telegram_retry_at
from workflow_v2_outcomes
where deployment ~ '^0x[0-9a-fA-F]{40}$'
on conflict (deployment, chain, transaction_hash, log_index) do update set
  telegram_processed_at = coalesce(
    workflow_v2_outcomes.telegram_processed_at,
    excluded.telegram_processed_at
  );
delete from workflow_v2_outcomes where deployment ~ '^0x[0-9a-fA-F]{40}$';

insert into workflow_v2_market_listings (
  deployment, chain, id, owner, agent, workflow_id, program_hash, program,
  title, description, visible, block_number, log_index
)
select
  (case when chain in (1597, 130, 8453) then '1597:' else '5318007:' end) || lower(deployment),
  chain,
  id,
  owner,
  agent,
  workflow_id,
  program_hash,
  program,
  title,
  description,
  visible,
  block_number,
  log_index
from workflow_v2_market_listings
where deployment ~ '^0x[0-9a-fA-F]{40}$'
on conflict (deployment, id) do update set
  visible = workflow_v2_market_listings.visible and excluded.visible;
delete from workflow_v2_market_listings where deployment ~ '^0x[0-9a-fA-F]{40}$';

insert into telegram_payout_windows (
  deployment, agent, workflow_id, epoch, deadline, chain, vault, block_number, message
)
select
  (case when chain in (1597, 130, 8453) then '1597:' else '5318007:' end) || lower(deployment),
  agent,
  workflow_id,
  epoch,
  deadline,
  chain,
  vault,
  block_number,
  message
from telegram_payout_windows
where deployment ~ '^0x[0-9a-fA-F]{40}$'
on conflict (deployment, agent, workflow_id, epoch, deadline) do nothing;
delete from telegram_payout_windows where deployment ~ '^0x[0-9a-fA-F]{40}$';

insert into telegram_funding_checks (
  deployment, agent, chain, created_at, due_at, lease, lease_until, block_number, checked_at,
  state, connection_id, enabled_since, funding_since, episode, warned, warned_urgent, recovery_pending
)
select
  (case when chain in (1597, 130, 8453) then '1597:' else '5318007:' end) || lower(deployment),
  agent,
  chain,
  created_at,
  due_at,
  lease,
  lease_until,
  block_number,
  checked_at,
  state,
  connection_id,
  enabled_since,
  funding_since,
  episode,
  warned,
  warned_urgent,
  recovery_pending
from telegram_funding_checks
where deployment ~ '^0x[0-9a-fA-F]{40}$'
on conflict (deployment, agent, chain) do nothing;
delete from telegram_funding_checks where deployment ~ '^0x[0-9a-fA-F]{40}$';

update telegram_deliveries d
set
  alert_data = jsonb_set(
    d.alert_data,
    '{deployment}',
    to_jsonb(
      (case when d.chain_id in (1597, 130, 8453) then '1597:' else '5318007:' end)
      || lower(d.alert_data ->> 'deployment')
    )
  ),
  alert_key = case
    when d.alert_key is not null
      and left(lower(d.alert_key), 43) = lower(d.alert_data ->> 'deployment') || ':'
      and not exists (
        select 1 from telegram_deliveries existing
        where existing.alert_key = (
          (case when d.chain_id in (1597, 130, 8453) then '1597:' else '5318007:' end)
          || lower(d.alert_data ->> 'deployment')
          || substr(d.alert_key, 43)
        )
      )
    then (case when d.chain_id in (1597, 130, 8453) then '1597:' else '5318007:' end)
      || lower(d.alert_data ->> 'deployment')
      || substr(d.alert_key, 43)
    else d.alert_key
  end
where d.alert_data is not null
  and d.alert_data ? 'deployment'
  and (d.alert_data ->> 'deployment') ~ '^0x[0-9a-fA-F]{40}$';

-- 2. Filter workflow_v2_health by the requested funds chains.
drop function workflow_v2_health(text, text);
create function workflow_v2_health(p_deployment text, p_owner text, p_chains integer[] default null)
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
      and (p_chains is null or chain = any(p_chains))
    order by workflow_id, lasna_block desc, id desc, chain desc
  ),
  success as (
    select distinct on (workflow_id) *
    from workflow_v2_activity
    where deployment = p_deployment and owner = p_owner
      and (p_chains is null or chain = any(p_chains))
      and status = 'confirmed'
    order by workflow_id, lasna_block desc, id desc, chain desc
  ),
  pending as (
    select distinct on (workflow_id) *
    from workflow_v2_activity
    where deployment = p_deployment and owner = p_owner
      and (p_chains is null or chain = any(p_chains))
      and status = 'pending'
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

-- 3. Add automation_chain scoping to all Telegram account/session/pairing/delivery tables.
alter table telegram_accounts
  add column automation_chain integer not null default 5318007
  check (automation_chain in (5318007, 1597));
alter table telegram_sessions
  add column automation_chain integer not null default 5318007
  check (automation_chain in (5318007, 1597));
alter table telegram_pairings
  add column automation_chain integer not null default 5318007
  check (automation_chain in (5318007, 1597));
alter table telegram_workflow_preferences
  add column automation_chain integer not null default 5318007
  check (automation_chain in (5318007, 1597));
alter table telegram_rule_preferences
  add column automation_chain integer not null default 5318007
  check (automation_chain in (5318007, 1597));
alter table telegram_deliveries
  add column automation_chain integer not null default 5318007
  check (automation_chain in (5318007, 1597));
alter table telegram_funding_checks
  add column automation_chain integer not null default 5318007
  check (automation_chain in (5318007, 1597));

do $$
declare
  fk record;
begin
  for fk in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'f'
      and confrelid = 'telegram_accounts'::regclass
  loop
    execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
  end loop;
end;
$$;

alter table telegram_accounts drop constraint telegram_accounts_pkey;
alter table telegram_pairings drop constraint telegram_pairings_pkey;
alter table telegram_rule_preferences drop constraint telegram_rule_preferences_pkey;
alter table telegram_workflow_preferences drop constraint telegram_workflow_preferences_pkey;

-- Migrate existing agents that have exclusively mainnet evidence to automation_chain = 1597.
-- Colliding agents (evidence on both testnet and mainnet) remain on 5318007; mainnet deliveries
-- and funding checks get a disconnected 1597 placeholder without copying chat_id or sessions.
with known_agents as (
  select agent from telegram_accounts
  union select agent from telegram_sessions
  union select agent from telegram_pairings
),
mainnet_only_agents as (
  select k.agent
  from known_agents k
  where (
    exists (select 1 from workflow_v2_accounts w where w.agent = k.agent and w.chain = 1597)
    or exists (select 1 from telegram_deliveries d where d.agent = k.agent and d.chain_id in (1597, 130, 8453))
    or exists (select 1 from telegram_funding_checks f where f.agent = k.agent and f.chain in (1597, 130, 8453))
  )
    and not exists (select 1 from workflow_v2_accounts w where w.agent = k.agent and w.chain = 5318007)
    and not exists (select 1 from telegram_deliveries d where d.agent = k.agent and d.chain_id in (5318007, 1301, 84532))
    and not exists (select 1 from telegram_funding_checks f where f.agent = k.agent and f.chain in (5318007, 1301, 84532))
    and not exists (select 1 from rules r where r.agent = k.agent)
)
update telegram_accounts a
set automation_chain = 1597
from mainnet_only_agents m
where a.agent = m.agent;

update telegram_sessions s
set automation_chain = 1597
where exists (select 1 from telegram_accounts a where a.agent = s.agent and a.automation_chain = 1597)
  and not exists (select 1 from telegram_accounts a where a.agent = s.agent and a.automation_chain = 5318007);

update telegram_pairings p
set automation_chain = 1597
where exists (select 1 from telegram_accounts a where a.agent = p.agent and a.automation_chain = 1597)
  and not exists (select 1 from telegram_accounts a where a.agent = p.agent and a.automation_chain = 5318007);

update telegram_workflow_preferences p
set automation_chain = 1597
where exists (select 1 from telegram_accounts a where a.agent = p.agent and a.automation_chain = 1597)
  and not exists (select 1 from telegram_accounts a where a.agent = p.agent and a.automation_chain = 5318007);

update telegram_rule_preferences p
set automation_chain = 1597
where exists (select 1 from telegram_accounts a where a.agent = p.agent and a.automation_chain = 1597)
  and not exists (select 1 from telegram_accounts a where a.agent = p.agent and a.automation_chain = 5318007);

update telegram_deliveries d
set automation_chain = 1597
where d.chain_id is null
  and exists (select 1 from telegram_accounts a where a.agent = d.agent and a.automation_chain = 1597)
  and not exists (select 1 from telegram_accounts a where a.agent = d.agent and a.automation_chain = 5318007);

insert into telegram_accounts (automation_chain, agent, enabled)
select distinct 1597, agent, false
from (
  select agent from telegram_deliveries where chain_id in (1597, 130, 8453)
  union
  select agent from telegram_funding_checks where chain in (1597, 130, 8453)
) mainnet_rows
where not exists (
  select 1 from telegram_accounts a where a.automation_chain = 1597 and a.agent = mainnet_rows.agent
)
on conflict do nothing;

update telegram_deliveries
set
  automation_chain = 1597,
  status = case
    when status in ('pending', 'sending')
      and not exists (
        select 1 from telegram_accounts a
        where a.automation_chain = 1597 and a.agent = telegram_deliveries.agent
          and a.connection_id = telegram_deliveries.connection_id
      )
    then 'cancelled'
    else status
  end,
  lease = case
    when status in ('pending', 'sending')
      and not exists (
        select 1 from telegram_accounts a
        where a.automation_chain = 1597 and a.agent = telegram_deliveries.agent
          and a.connection_id = telegram_deliveries.connection_id
      )
    then null
    else lease
  end
where chain_id in (1597, 130, 8453);

update telegram_funding_checks
set automation_chain = 1597
where chain in (1597, 130, 8453);

alter table telegram_accounts add primary key (automation_chain, agent);
alter table telegram_pairings add primary key (automation_chain, agent);
alter table telegram_rule_preferences add primary key (automation_chain, agent, rule_id);
alter table telegram_workflow_preferences add primary key (automation_chain, agent, workflow_id);

alter table telegram_rule_preferences
  add foreign key (automation_chain, agent) references telegram_accounts (automation_chain, agent);
alter table telegram_workflow_preferences
  add foreign key (automation_chain, agent) references telegram_accounts (automation_chain, agent);
alter table telegram_deliveries
  add foreign key (automation_chain, agent) references telegram_accounts (automation_chain, agent);
alter table telegram_funding_checks
  add foreign key (automation_chain, agent) references telegram_accounts (automation_chain, agent) on delete cascade;

alter table telegram_funding_checks
  add constraint telegram_funding_checks_chain_match
  check (automation_chain = case when chain in (1597, 130, 8453) then 1597 else 5318007 end);

drop index telegram_deliveries_test_idx;
create index telegram_deliveries_test_idx
  on telegram_deliveries (automation_chain, agent, connection_id, id desc)
  where chain_id is null;
drop index telegram_problem_history;
create index telegram_problem_history
  on telegram_deliveries (automation_chain, agent, workflow_id, created_at desc)
  where alert_kind in ('failed', 'expired', 'unfinished');
drop index telegram_account_alert_history;
create index telegram_account_alert_history
  on telegram_deliveries (automation_chain, agent, connection_id, id desc)
  where alert_kind is not null;
create index telegram_sessions_lookup_idx
  on telegram_sessions (automation_chain, agent, token_hash);

-- 4. Drop old single-environment function signatures and recreate them with automation_chain scoping.
drop function telegram_alert_status(text, text, text);
drop function telegram_workflow_status(text, text, text);
drop function telegram_notification_status(text, text);
drop function telegram_status(text, text);
drop function telegram_pair_begin(text, text, text, timestamptz);
drop function telegram_pair_confirm(text, text, text);
drop function telegram_disconnect(text);
drop function telegram_set_preferences(text, boolean, text, text, text);
drop function telegram_set_alert_preferences(text, boolean, boolean);
drop function telegram_set_workflow_preference(text, text, text, text);
drop function telegram_enqueue(text, integer, text, integer, text, timestamptz, text);
drop function telegram_destination(text, numeric, timestamptz);
drop function telegram_workflow_destination(text, text, timestamptz);
drop function telegram_alert_destination(text, text, timestamptz);

create function telegram_pair_begin(
  p_agent text,
  p_session text,
  p_token text,
  p_expiry timestamptz,
  p_automation_chain integer default 5318007
)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_automation_chain::text || ':' || p_agent, 8008));
  if exists (
    select 1 from telegram_accounts
    where automation_chain = p_automation_chain and agent = p_agent and chat_id is not null and not blocked
  ) then
    return false;
  end if;
  insert into telegram_pairings (automation_chain, agent, session_hash, token_hash, expires_at)
  values (p_automation_chain, p_agent, p_session, p_token, p_expiry)
  on conflict (automation_chain, agent) do update set
    session_hash = excluded.session_hash,
    token_hash = excluded.token_hash,
    expires_at = excluded.expires_at,
    chat_id = null,
    profile = null;
  return true;
end;
$$;

create function telegram_pair_confirm(
  p_agent text,
  p_session text,
  p_pairing text,
  p_automation_chain integer default 5318007
)
returns boolean language plpgsql set search_path = public as $$
declare
  pairing telegram_pairings%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_automation_chain::text || ':' || p_agent, 8008));
  delete from telegram_pairings
  where automation_chain = p_automation_chain
    and agent = p_agent
    and session_hash = p_session
    and token_hash = p_pairing
    and expires_at > now()
    and chat_id is not null
  returning * into pairing;
  if not found then return false; end if;
  insert into telegram_accounts (automation_chain, agent, connection_id, chat_id, profile)
  values (p_automation_chain, p_agent, gen_random_uuid(), pairing.chat_id, pairing.profile)
  on conflict (automation_chain, agent) do update set
    connection_id = excluded.connection_id,
    chat_id = excluded.chat_id,
    profile = excluded.profile,
    blocked = false,
    enabled = true,
    enabled_since = clock_timestamp();
  return true;
end;
$$;

create function telegram_disconnect(p_agent text, p_automation_chain integer default 5318007)
returns void language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_automation_chain::text || ':' || p_agent, 8008));
  delete from telegram_pairings where automation_chain = p_automation_chain and agent = p_agent;
  update telegram_accounts
  set chat_id = null, profile = null, blocked = false, connection_id = null
  where automation_chain = p_automation_chain and agent = p_agent;
end;
$$;

create or replace function telegram_webhook(p_update bigint, p_chat text, p_profile text, p_token text, p_stop boolean)
returns boolean language plpgsql set search_path = public as $$
declare
  target record;
  target_chain integer;
  target_agent text;
begin
  insert into telegram_updates (update_id) values (p_update) on conflict do nothing;
  if not found then return false; end if;
  if p_stop then
    for target in
      select automation_chain, agent from telegram_accounts where chat_id = p_chat
      union select automation_chain, agent from telegram_pairings where chat_id = p_chat
      order by 1, 2
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(target.automation_chain::text || ':' || target.agent, 8008)
      );
      delete from telegram_pairings
      where automation_chain = target.automation_chain and agent = target.agent and chat_id = p_chat;
      update telegram_accounts
      set chat_id = null, profile = null, blocked = false, connection_id = null
      where automation_chain = target.automation_chain and agent = target.agent and chat_id = p_chat;
    end loop;
    return true;
  end if;
  select automation_chain, agent into target_chain, target_agent
  from telegram_pairings
  where token_hash = p_token;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_chain::text || ':' || target_agent, 8008));
  update telegram_pairings
  set chat_id = p_chat, profile = p_profile
  where automation_chain = target_chain
    and agent = target_agent
    and token_hash = p_token
    and chat_id is null
    and expires_at > now();
  return found;
end;
$$;

create function telegram_set_preferences(
  p_agent text,
  p_enabled boolean,
  p_mode text,
  p_rule text,
  p_preference text,
  p_automation_chain integer default 5318007
)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_automation_chain::text || ':' || p_agent, 8008));
  if p_rule is not null then
    if p_automation_chain <> 5318007
      or not exists (
        select 1 from rules where agent = p_agent and rule_id = p_rule::numeric and status <> 'cancelled'
      )
    then return false; end if;
    insert into telegram_rule_preferences (automation_chain, agent, rule_id, preference)
    select p_automation_chain, p_agent, p_rule::numeric, p_preference
    from telegram_accounts
    where automation_chain = p_automation_chain and agent = p_agent
    on conflict (automation_chain, agent, rule_id) do update set
      preference = excluded.preference,
      changed_at = clock_timestamp()
    where telegram_rule_preferences.preference is distinct from excluded.preference;
    return found or exists (
      select 1 from telegram_accounts where automation_chain = p_automation_chain and agent = p_agent
    );
  end if;
  update telegram_accounts set
    enabled_since = case when p_enabled is not null and enabled <> p_enabled then clock_timestamp() else enabled_since end,
    defaults_since = case when p_mode is not null and default_mode <> p_mode then clock_timestamp() else defaults_since end,
    enabled = coalesce(p_enabled, enabled),
    default_mode = coalesce(p_mode, default_mode)
  where automation_chain = p_automation_chain and agent = p_agent;
  return found;
end;
$$;

create function telegram_set_alert_preferences(
  p_agent text,
  p_funding boolean,
  p_action boolean,
  p_automation_chain integer default 5318007
)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_automation_chain::text || ':' || p_agent, 8008));
  update telegram_accounts set
    funding_alerts = coalesce(p_funding, funding_alerts),
    action_alerts = coalesce(p_action, action_alerts),
    funding_since = case when p_funding is distinct from funding_alerts and p_funding is not null
      then clock_timestamp() else funding_since end,
    action_since = case when p_action is distinct from action_alerts and p_action is not null
      then clock_timestamp() else action_since end
  where automation_chain = p_automation_chain and agent = p_agent;
  return found;
end;
$$;

create function telegram_set_workflow_preference(
  p_deployment text,
  p_agent text,
  p_workflow text,
  p_preference text,
  p_automation_chain integer default 5318007
)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_automation_chain::text || ':' || p_agent, 8008));
  if not exists (
    select 1 from workflow_v2_activations
    where deployment = p_deployment and agent = p_agent and workflow_id = p_workflow
  ) then
    return false;
  end if;
  insert into telegram_workflow_preferences (automation_chain, agent, workflow_id, preference)
  select p_automation_chain, p_agent, p_workflow, p_preference
  from telegram_accounts
  where automation_chain = p_automation_chain and agent = p_agent
  on conflict (automation_chain, agent, workflow_id) do update set
    preference = excluded.preference,
    changed_at = clock_timestamp()
  where telegram_workflow_preferences.preference is distinct from excluded.preference;
  return exists (
    select 1 from telegram_accounts where automation_chain = p_automation_chain and agent = p_agent
  );
end;
$$;

create function telegram_status(
  p_agent text,
  p_session text,
  p_automation_chain integer default 5318007
)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'connection', case when a.blocked then 'blocked' when a.chat_id is not null then 'connected' else 'disconnected' end,
    'profile', a.profile,
    'configured', a.agent is not null,
    'enabled', coalesce(a.enabled, true),
    'defaultMode', coalesce(a.default_mode, 'all'),
    'pendingPairing', (
      select jsonb_build_object('id', token_hash, 'profile', profile)
      from telegram_pairings
      where automation_chain = p_automation_chain
        and agent = p_agent
        and session_hash = p_session
        and expires_at > now()
        and chat_id is not null
    ),
    'testDelivery', (
      select case when status in ('pending', 'sending') then 'pending'
        when status = 'sent' then 'sent' else 'failed' end
      from telegram_deliveries
      where automation_chain = p_automation_chain
        and agent = p_agent
        and connection_id = a.connection_id
        and chain_id is null
      order by id desc limit 1
    ),
    'rules', case when p_automation_chain = 5318007 then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.rule_id::text, 'template', r.template,
        'preference', coalesce(p.preference, 'inherit')) order by r.rule_id)
      from rules r
      left join telegram_rule_preferences p
        on p.automation_chain = p_automation_chain and p.agent = r.agent and p.rule_id = r.rule_id
      where r.agent = p_agent and r.template in (11, 12, 13) and r.status <> 'cancelled'
    ), '[]'::jsonb) else '[]'::jsonb end
  )
  from (select p_automation_chain as automation_chain, p_agent as agent) requested
  left join telegram_accounts a using (automation_chain, agent);
$$;

create function telegram_notification_status(
  p_agent text,
  p_session text,
  p_automation_chain integer default 5318007
)
returns jsonb language sql stable set search_path = public as $$
  select telegram_status(p_agent, p_session, p_automation_chain) || jsonb_build_object(
    'rules',
    case when p_automation_chain = 5318007 then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.rule_id::text, 'template', r.template,
        'preference', coalesce(p.preference, 'inherit')) order by r.rule_id)
      from rules r
      left join telegram_rule_preferences p
        on p.automation_chain = p_automation_chain and p.agent = r.agent and p.rule_id = r.rule_id
      where r.agent = p_agent and r.status <> 'cancelled'
    ), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

create function telegram_workflow_status(
  p_deployment text,
  p_agent text,
  p_session text,
  p_automation_chain integer default 5318007
)
returns jsonb language sql stable set search_path = public as $$
  select telegram_notification_status(p_agent, p_session, p_automation_chain) || jsonb_build_object(
    'workflows',
    coalesce((
      select jsonb_agg(jsonb_build_object('id', w.workflow_id, 'title', w.title,
        'preference', coalesce(p.preference, 'inherit')) order by w.title, w.workflow_id)
      from (
        select distinct on (workflow_id) workflow_id, title
        from workflow_v2_activations
        where deployment = p_deployment and agent = p_agent
        order by workflow_id, epoch::numeric desc
      ) w
      left join telegram_workflow_preferences p
        on p.automation_chain = p_automation_chain and p.agent = p_agent and p.workflow_id = w.workflow_id
    ), '[]'::jsonb)
  );
$$;

create function telegram_alert_status(
  p_deployment text,
  p_agent text,
  p_session text,
  p_automation_chain integer default 5318007
)
returns jsonb language sql stable set search_path = public as $$
  select telegram_workflow_status(p_deployment, p_agent, p_session, p_automation_chain) || jsonb_build_object(
    'fundingAlerts', coalesce(a.funding_alerts, true),
    'actionAlerts', coalesce(a.action_alerts, true),
    'lastProblemDelivery', (
      select jsonb_build_object('status', d.status, 'at', d.created_at)
      from telegram_deliveries d
      where d.automation_chain = p_automation_chain
        and d.agent = p_agent
        and d.connection_id = a.connection_id
        and d.alert_kind is not null
        and d.status in ('sent', 'failed')
      order by d.id desc limit 1
    )
  )
  from (select p_automation_chain as automation_chain, p_agent as agent) requested
  left join telegram_accounts a using (automation_chain, agent);
$$;

create function telegram_destination(
  p_agent text,
  p_rule numeric,
  p_time timestamptz,
  p_automation_chain integer default 5318007
)
returns setof telegram_accounts language sql stable set search_path = public as $$
  select a.* from telegram_accounts a
  left join telegram_rule_preferences r
    on r.automation_chain = a.automation_chain and r.agent = a.agent and r.rule_id = p_rule
  where a.automation_chain = p_automation_chain
    and a.agent = p_agent
    and a.chat_id is not null
    and not a.blocked
    and (
      p_rule is null or (
        a.enabled and p_time > a.enabled_since and p_time > coalesce(r.changed_at, '-infinity')
        and (
          r.preference = 'send'
          or (coalesce(r.preference, 'inherit') = 'inherit' and a.default_mode = 'all' and p_time > a.defaults_since)
        )
      )
    );
$$;

create function telegram_workflow_destination(
  p_agent text,
  p_workflow text,
  p_time timestamptz,
  p_automation_chain integer default 5318007
)
returns setof telegram_accounts language sql stable set search_path = public as $$
  select a.* from telegram_accounts a
  left join telegram_workflow_preferences p
    on p.automation_chain = a.automation_chain and p.agent = a.agent and p.workflow_id = p_workflow
  where a.automation_chain = p_automation_chain
    and a.agent = p_agent
    and a.chat_id is not null
    and not a.blocked
    and a.enabled
    and p_time > a.enabled_since
    and p_time > coalesce(p.changed_at, '-infinity')
    and (
      p.preference = 'send'
      or (coalesce(p.preference, 'inherit') = 'inherit' and a.default_mode = 'all' and p_time > a.defaults_since)
    );
$$;

create function telegram_alert_destination(
  p_agent text,
  p_kind text,
  p_time timestamptz,
  p_automation_chain integer default 5318007
)
returns setof telegram_accounts language sql stable set search_path = public as $$
  select a.* from telegram_accounts a
  where a.automation_chain = p_automation_chain
    and a.agent = p_agent
    and a.chat_id is not null
    and not a.blocked
    and a.enabled
    and p_time > a.enabled_since
    and case
      when p_kind = 'funding' then a.funding_alerts and p_time > a.funding_since
      else a.action_alerts and p_time > a.action_since
    end;
$$;

create function telegram_enqueue(
  p_agent text,
  p_chain integer,
  p_tx text,
  p_index integer,
  p_rule text,
  p_time timestamptz,
  p_message text,
  p_automation_chain integer default 5318007
)
returns boolean language plpgsql set search_path = public as $$
declare
  enqueued boolean;
  auto_chain integer;
begin
  auto_chain := case
    when p_chain is not null and p_chain in (130, 8453, 1597) then 1597
    when p_chain is not null then 5318007
    else p_automation_chain
  end;
  perform pg_advisory_xact_lock(hashtextextended(auto_chain::text || ':' || p_agent, 8008));
  if p_rule is null and exists (
    select 1 from telegram_deliveries d
    join telegram_accounts a
      on a.automation_chain = d.automation_chain and a.agent = d.agent and a.connection_id = d.connection_id
    where d.automation_chain = auto_chain and d.agent = p_agent and d.chain_id is null
      and d.created_at > now() - interval '1 minute'
  ) then
    return false;
  end if;
  insert into telegram_deliveries (
    automation_chain, agent, connection_id, chain_id, tx_hash, log_index, rule_id, block_time, message
  )
  select auto_chain, p_agent, connection_id, p_chain, p_tx, p_index, p_rule::numeric, p_time, p_message
  from telegram_destination(p_agent, p_rule::numeric, p_time, auto_chain)
  where p_message is not null and (p_rule is null or p_time > now() - interval '1 day')
  on conflict (chain_id, tx_hash, log_index) do nothing;
  enqueued := found;
  if p_rule is not null then
    update telegram_alert_outbox set processed_at = now()
    where chain_id = p_chain and tx_hash = p_tx and log_index = p_index and processed_at is null;
  end if;
  return enqueued;
end;
$$;

create or replace function telegram_pending_notifications()
returns table (chain_id int, tx_hash text, log_index int, agent text, rule_id text, template smallint,
    observed text, block_time timestamptz, execution jsonb, eligible boolean)
language sql stable set search_path = public as $$
  select a.chain_id, a.tx_hash, a.log_index, a.agent, a.rule_id::text, coalesce(a.template, r.template),
    a.observed::text, a.block_time, a.execution,
    a.block_time > now() - interval '1 day'
      and exists (select 1 from telegram_destination(a.agent, a.rule_id, a.block_time, 5318007))
  from telegram_alert_outbox a left join rules r using (agent, rule_id)
  where a.processed_at is null and a.retry_at <= now()
  order by a.staged_at, a.chain_id, a.tx_hash, a.log_index limit 25;
$$;

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
      'Rulebook · Workflow confirmed', c.title, p_origin || '/runs/' || c.run_id,
      p_explorer || '/tx/' || c.transaction_hash)
  from candidates c join handled h using (deployment, chain, transaction_hash, log_index)
  cross join lateral telegram_workflow_destination(c.agent, c.workflow_id, c.telegram_block_time, c.auto_chain) a
  on conflict (chain_id, tx_hash, log_index) do nothing;
$$;

create or replace function telegram_workflow_candidates(p_deployment text, p_chain int)
returns jsonb language sql set search_path = public as $$
  with pending as materialized (
    select o.transaction_hash, o.log_index, o.block_number, o.vault, o.run_id, o.workflow_id,
      o.epoch, o.status, o.reason, o.title, o.program_hash,
      o.origin_chain, o.origin_transaction, o.origin_log_index,
      case when o.status = 6 then true when o.status = 1 then exists (
        select 1 from telegram_workflow_destination(
          o.agent, o.workflow_id, o.telegram_block_time,
          case when p_chain in (130, 8453, 1597) then 1597 else 5318007 end
        )
      ) else exists (
        select 1 from telegram_alert_destination(
          o.agent, 'action', o.telegram_block_time,
          case when p_chain in (130, 8453, 1597) then 1597 else 5318007 end
        )
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

create or replace function telegram_complete_workflow(p_deployment text, p_chain int, p_tx text,
  p_index int, p_message text, p_deadline bigint)
returns void language plpgsql set search_path = public as $$
declare
  o telegram_workflow_outcomes%rowtype;
  kind text;
  metadata jsonb;
  auto_chain int;
begin
  select * into o from telegram_workflow_outcomes
  where (deployment, chain, transaction_hash, log_index) = (p_deployment, p_chain, p_tx, p_index);
  if not found then return; end if;
  auto_chain := case when p_chain in (130, 8453, 1597) then 1597 else 5318007 end;
  perform pg_advisory_xact_lock(hashtextextended(auto_chain::text || ':' || o.agent, 8008));
  update workflow_v2_outcomes set telegram_processed_at = now()
  where (deployment, chain, transaction_hash, log_index) = (p_deployment, p_chain, p_tx, p_index)
    and telegram_processed_at is null and telegram_block_time > now() - interval '1 day';
  if not found or p_message is null then return; end if;

  if o.status = 1 then
    insert into telegram_deliveries (
      automation_chain, agent, connection_id, chain_id, tx_hash, log_index, workflow_id, block_time, message
    )
    select auto_chain, o.agent, a.connection_id, p_chain, p_tx, p_index, o.workflow_id, o.telegram_block_time, p_message
    from telegram_workflow_destination(o.agent, o.workflow_id, o.telegram_block_time, auto_chain) a
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
  insert into telegram_deliveries (
    automation_chain, agent, connection_id, chain_id, tx_hash, log_index, workflow_id,
    block_time, message, alert_kind, alert_data
  )
  select auto_chain, o.agent, a.connection_id, p_chain, p_tx, p_index, o.workflow_id, o.telegram_block_time,
    p_message, kind, metadata
  from telegram_alert_destination(o.agent, kind, o.telegram_block_time, auto_chain) a
  where (kind <> 'expired' or not exists (
    select 1 from telegram_deliveries d where d.alert_key = p_deployment || ':unfinished:' || o.run_id
      and d.automation_chain = auto_chain and d.connection_id = a.connection_id and d.status = 'sent'
  )) and not exists (
    select 1 from telegram_deliveries d where d.automation_chain = auto_chain and d.agent = o.agent
      and d.workflow_id = o.workflow_id and d.connection_id = a.connection_id
      and d.alert_kind = kind and d.alert_data = metadata
      and d.status in ('pending', 'sending', 'sent') and d.created_at > now() - interval '1 hour'
  )
  on conflict do nothing;
end;
$$;

create or replace function telegram_queue_payout_warnings(p_deployment text)
returns void language sql set search_path = public as $$
  insert into telegram_deliveries (
    automation_chain, agent, connection_id, chain_id, workflow_id,
    block_time, message, alert_kind, alert_data, alert_key
  )
  select ac.auto_chain, w.agent, a.connection_id, w.chain, w.workflow_id, clock_timestamp(), w.message, 'payout',
    jsonb_build_object('kind', 'payout', 'chain', w.chain, 'vault', w.vault,
      'workflow', w.workflow_id, 'epoch', w.epoch, 'deadline', w.deadline,
      'block', w.block_number::text, 'deployment', w.deployment),
    k.delivery_key
  from telegram_payout_windows w
  cross join lateral (select case when w.chain in (130, 8453, 1597) then 1597 else 5318007 end as auto_chain) ac
  cross join lateral telegram_alert_destination(w.agent, 'payout', clock_timestamp(), ac.auto_chain) a
  cross join lateral (select concat_ws(':', w.deployment, w.agent, w.workflow_id, w.epoch, w.deadline,
    a.connection_id, extract(epoch from a.enabled_since), extract(epoch from a.action_since)) as delivery_key) k
  where w.deployment = p_deployment and w.deadline > extract(epoch from now())
    and not exists (select 1 from telegram_deliveries d where d.alert_key = k.delivery_key)
  order by w.deadline limit 25 on conflict (alert_key) do nothing;
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
        p_origin || '/runs/' || candidate.id),
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

create or replace function telegram_claim_funding(p_deployment text, p_chain int, p_limit int)
returns jsonb language plpgsql set search_path = public as $$
declare
  result jsonb;
  auto_chain int;
begin
  auto_chain := case when p_chain in (130, 8453, 1597) then 1597 else 5318007 end;
  -- Seed a bounded number of jobs. The joins only use accounts from the configured factories.
  insert into telegram_funding_checks (automation_chain, deployment, agent, chain)
  select auto_chain, p_deployment, a.agent, p_chain
  from telegram_accounts a
  join workflow_v2_accounts w on w.deployment = p_deployment and w.chain = auto_chain and w.address = a.agent
  where a.automation_chain = auto_chain
    and a.chat_id is not null and not a.blocked and a.enabled and a.funding_alerts
    and (p_chain = auto_chain or exists (select 1 from workflow_v2_accounts v
      where v.deployment = p_deployment and v.chain = p_chain and v.owner = w.owner and v.agent = w.address))
    and exists (select 1 from workflow_v2_activations e where e.deployment = p_deployment and e.agent = a.agent)
    and not exists (select 1 from telegram_funding_checks f where f.deployment = p_deployment
      and f.agent = a.agent and f.chain = p_chain)
  order by a.agent limit p_limit on conflict do nothing;
  with candidates as (
    select f.deployment, f.agent, f.chain, v.address as vault
    from telegram_funding_checks f
    join telegram_accounts a using (automation_chain, agent)
    join workflow_v2_accounts w on w.deployment = f.deployment and w.chain = auto_chain and w.address = f.agent
    left join workflow_v2_accounts v on v.deployment = f.deployment and v.chain = p_chain
      and v.owner = w.owner and v.agent = w.address
    where f.automation_chain = auto_chain
      and f.deployment = p_deployment and f.chain = p_chain and f.due_at <= now()
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
  auto_chain := case when p_chain in (130, 8453, 1597) then 1597 else 5318007 end;
  perform pg_advisory_xact_lock(hashtextextended(auto_chain::text || ':' || p_agent, 8008));
  select * into previous from telegram_funding_checks
  where (deployment, agent, chain) = (p_deployment, p_agent, p_chain)
    and automation_chain = auto_chain
    and lease = p_lease
    and lease_until > now()
  for update;
  if not found then return; end if;
  select * into recipient from telegram_alert_destination(p_agent, 'funding', clock_timestamp(), auto_chain);
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
      select 1 from telegram_deliveries d
      where d.automation_chain = auto_chain and d.agent = p_agent and d.chain_id = p_chain
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
  insert into telegram_deliveries (
    automation_chain, agent, connection_id, chain_id, block_time, message, alert_kind, alert_data
  )
  values (auto_chain, p_agent, recipient.connection_id, p_chain, clock_timestamp(), message, 'funding',
    jsonb_build_object('kind', 'funding', 'deployment', p_deployment, 'chain', p_chain, 'state', p_state,
      'beneficiary', beneficiary, 'episode', episode_number, 'block', p_block::text));
end;
$$;

create or replace function telegram_prepare(p_id text, p_lease uuid)
returns table (chat_id text, message text, attempts int, preflight jsonb)
language plpgsql set search_path = public as $$
declare
  delivery telegram_deliveries%rowtype;
  target_chain int;
  target text;
  recipient text;
begin
  select automation_chain, agent into target_chain, target
  from telegram_deliveries
  where id = p_id::bigint and status = 'sending' and lease = p_lease and due_at > now();
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_chain::text || ':' || target, 8008));
  select * into delivery from telegram_deliveries
  where id = p_id::bigint and status = 'sending' and lease = p_lease
    and due_at > clock_timestamp() + interval '12 seconds'
  for update;
  if not found then return; end if;
  if delivery.alert_kind is not null then
    select a.chat_id into recipient
    from telegram_alert_destination(delivery.agent, delivery.alert_kind, delivery.block_time, delivery.automation_chain) a
    where a.connection_id = delivery.connection_id;
    if delivery.alert_kind = 'funding' and not exists (
      select 1 from telegram_funding_checks f
      where f.automation_chain = delivery.automation_chain
        and f.deployment = delivery.alert_data ->> 'deployment'
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
    select a.chat_id into recipient
    from telegram_destination(delivery.agent, delivery.rule_id, delivery.block_time, delivery.automation_chain) a
    where a.connection_id = delivery.connection_id;
  else
    select a.chat_id into recipient
    from telegram_workflow_destination(delivery.agent, delivery.workflow_id, delivery.block_time, delivery.automation_chain) a
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

create or replace function telegram_finish(p_id text, p_lease uuid, p_result text, p_delay int)
returns void language plpgsql set search_path = public as $$
declare
  target_chain int;
  target text;
  delivery telegram_deliveries%rowtype;
begin
  select automation_chain, agent into target_chain, target
  from telegram_deliveries
  where id = p_id::bigint and lease = p_lease;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_chain::text || ':' || target, 8008));
  update telegram_deliveries set
    status = case when p_result = 'retry' then 'pending'
      when p_result in ('sent', 'cancelled') then p_result else 'failed' end,
    due_at = now() + make_interval(secs => p_delay),
    lease = null
  where id = p_id::bigint and lease = p_lease returning * into delivery;
  if p_result = 'blocked' and found then
    update telegram_accounts set blocked = true
    where automation_chain = target_chain and agent = target and connection_id = delivery.connection_id;
  elsif p_result = 'sent' and delivery.alert_kind = 'funding' and delivery.alert_data ->> 'state' <> 'healthy' then
    update telegram_funding_checks set warned = true,
      warned_urgent = warned_urgent or delivery.alert_data ->> 'state' in ('empty', 'debt')
    where automation_chain = target_chain
      and deployment = delivery.alert_data ->> 'deployment'
      and agent = target and chain = delivery.chain_id and connection_id = delivery.connection_id
      and episode = (delivery.alert_data ->> 'episode')::bigint;
  end if;
end;
$$;

create or replace function telegram_operational_metrics(p_deployment text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'overdueFundingChecks', (
      select count(*) from telegram_funding_checks f
      join telegram_accounts a using (automation_chain, agent)
      where f.deployment = p_deployment
        and a.enabled and a.funding_alerts and not a.blocked and a.chat_id is not null
        and coalesce(f.checked_at, f.created_at) < now() -
          case when f.state = 'inactive' then interval '10 minutes' else interval '5 minutes' end
    ),
    'pendingWorkflowAlerts', (
      select count(*) from workflow_v2_outcomes o where o.deployment = p_deployment
        and o.status in (1, 3, 4, 6) and o.telegram_processed_at is null
        and o.telegram_block_time > now() - interval '1 day'
    ),
    'oldestWorkflowSeconds', (
      select coalesce(extract(epoch from now() - min(o.telegram_block_time)), 0)
      from workflow_v2_outcomes o where o.deployment = p_deployment
        and o.status in (1, 3, 4, 6) and o.telegram_processed_at is null
        and o.telegram_block_time > now() - interval '1 day'
    )
  );
$$;

create or replace function telegram_ready()
returns boolean language sql stable set search_path = public as $$
  select has_table_privilege('telegram_sessions', 'SELECT')
    and has_table_privilege('telegram_sessions', 'INSERT')
    and has_table_privilege('telegram_alert_outbox', 'INSERT')
    and has_table_privilege('telegram_deliveries', 'UPDATE')
    and has_function_privilege('telegram_status(text,text,integer)', 'EXECUTE')
    and has_function_privilege('telegram_webhook(bigint,text,text,text,boolean)', 'EXECUTE')
    and has_function_privilege('telegram_pending_alerts()', 'EXECUTE')
    and has_function_privilege('telegram_claim()', 'EXECUTE')
    and exists (select 1 from pg_trigger where tgrelid = 'rule_events'::regclass
      and tgname = 'telegram_stage_event' and tgenabled in ('O', 'A'));
$$;

create or replace function telegram_notifications_ready()
returns boolean language sql stable set search_path = public as $$
  select telegram_ready()
    and has_function_privilege('telegram_notification_status(text,text,integer)', 'EXECUTE')
    and has_function_privilege('telegram_pending_notifications()', 'EXECUTE')
    and exists (select 1 from pg_trigger where tgrelid = 'executions'::regclass
      and tgname = 'telegram_stage_confirmed_execution' and tgenabled in ('O', 'A'));
$$;

create or replace function telegram_workflows_ready()
returns boolean language sql stable set search_path = public as $$
  select telegram_notifications_ready()
    and has_table_privilege('telegram_workflow_preferences', 'SELECT')
    and has_table_privilege('telegram_workflow_preferences', 'INSERT')
    and has_table_privilege('telegram_workflow_preferences', 'UPDATE')
    and has_function_privilege('telegram_workflow_status(text,text,text,integer)', 'EXECUTE')
    and has_function_privilege('telegram_set_workflow_preference(text,text,text,text,integer)', 'EXECUTE')
    and has_function_privilege('telegram_process_workflow_notifications(text,int,text,text)', 'EXECUTE');
$$;

create or replace function telegram_operational_ready()
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
    and has_function_privilege('telegram_set_alert_preferences(text,boolean,boolean,integer)', 'EXECUTE')
    and has_function_privilege('telegram_alert_status(text,text,text,integer)', 'EXECUTE')
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
    select 'table' as kind, quote_ident(tablename) as name from pg_tables
      where schemaname = 'public' and left(tablename, 9) = 'telegram_'
    union all
    select 'function', oid::regprocedure::text from pg_proc
      where pronamespace = 'public'::regnamespace
        and (left(proname, 9) = 'telegram_' or proname = 'workflow_v2_health')
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

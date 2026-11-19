-- Delivery settings are user data, independent of the chain-derived read model.
alter table rule_events add column telegram_template smallint,
  add column telegram_observed numeric(78, 0);

create table telegram_alert_outbox (
  chain_id int not null,
  tx_hash text not null,
  log_index int not null,
  agent text not null,
  rule_id numeric(78, 0) not null,
  template smallint not null,
  observed numeric(78, 0) not null,
  block_time timestamptz not null,
  staged_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (chain_id, tx_hash, log_index)
);
create index telegram_outbox_pending_idx on telegram_alert_outbox (staged_at)
  where processed_at is null;

-- Stage the delivery payload in the same transaction as the alert activity row. The live
-- decoder supplies the extra fields. A read-model rebuild omits them and stages nothing.
create function telegram_stage_alert()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into telegram_alert_outbox (chain_id, tx_hash, log_index, agent, rule_id, template, observed, block_time)
    values (new.chain_id, new.tx_hash, new.log_index, new.agent, new.rule_id, new.telegram_template,
      new.telegram_observed, new.block_time)
    on conflict (chain_id, tx_hash, log_index) do nothing;
  return new;
end;
$$;
create trigger telegram_stage_event after insert or update of telegram_template, telegram_observed on rule_events
  for each row when (new.kind = 'alert' and new.telegram_template is not null and new.telegram_observed is not null)
  execute function telegram_stage_alert();

create function telegram_pending_alerts()
returns table (chain_id int, tx_hash text, log_index int, agent text, rule_id text, template smallint,
    observed text, block_time timestamptz) language sql stable set search_path = public as $$
  select a.chain_id, a.tx_hash, a.log_index, a.agent, a.rule_id::text, a.template, a.observed::text, a.block_time
    from telegram_alert_outbox a where a.processed_at is null order by a.staged_at, a.chain_id, a.tx_hash, a.log_index
    limit 25;
$$;

create table telegram_accounts (
  agent text primary key,
  connection_id uuid,
  chat_id text,
  profile text,
  blocked boolean not null default false,
  enabled boolean not null default true,
  default_mode text not null default 'all' check (default_mode in ('all', 'selected')),
  enabled_since timestamptz not null default now(),
  defaults_since timestamptz not null default '-infinity'
);
create index telegram_accounts_chat_idx on telegram_accounts (chat_id) where chat_id is not null;

create table telegram_rule_preferences (
  agent text not null references telegram_accounts (agent),
  rule_id numeric(78, 0) not null,
  preference text not null check (preference in ('inherit', 'send', 'mute')),
  changed_at timestamptz not null default now(),
  primary key (agent, rule_id)
);

create table telegram_sessions (
  nonce text primary key,
  token_hash text not null unique,
  agent text not null,
  expires_at timestamptz not null
);

create table telegram_pairings (
  agent text primary key,
  session_hash text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  chat_id text,
  profile text
);

create table telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

create table telegram_deliveries (
  id bigint generated always as identity primary key,
  agent text not null references telegram_accounts (agent),
  connection_id uuid not null,
  chain_id int,
  tx_hash text,
  log_index int,
  rule_id numeric(78, 0),
  block_time timestamptz,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts int not null default 0,
  due_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  lease uuid,
  unique (chain_id, tx_hash, log_index)
);
create index telegram_deliveries_due_idx on telegram_deliveries (due_at, id)
  where status in ('pending', 'sending');
create index telegram_deliveries_test_idx on telegram_deliveries (agent, connection_id, id desc)
  where rule_id is null;

alter table telegram_accounts enable row level security;
alter table telegram_rule_preferences enable row level security;
alter table telegram_sessions enable row level security;
alter table telegram_pairings enable row level security;
alter table telegram_updates enable row level security;
alter table telegram_deliveries enable row level security;
alter table telegram_alert_outbox enable row level security;

create function telegram_pair_begin(p_agent text, p_session text, p_token text, p_expiry timestamptz)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  if exists (select 1 from telegram_accounts where agent = p_agent and chat_id is not null and not blocked) then
    return false;
  end if;
  insert into telegram_pairings (agent, session_hash, token_hash, expires_at)
  values (p_agent, p_session, p_token, p_expiry)
  on conflict (agent) do update set session_hash = excluded.session_hash,
    token_hash = excluded.token_hash, expires_at = excluded.expires_at, chat_id = null, profile = null;
  return true;
end;
$$;

create function telegram_pair_confirm(p_agent text, p_session text, p_pairing text)
returns boolean language plpgsql set search_path = public as $$
declare
  pairing telegram_pairings%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  delete from telegram_pairings where agent = p_agent and session_hash = p_session and token_hash = p_pairing
    and expires_at > now() and chat_id is not null returning * into pairing;
  if not found then return false; end if;
  insert into telegram_accounts (agent, connection_id, chat_id, profile)
    values (p_agent, gen_random_uuid(), pairing.chat_id, pairing.profile)
    on conflict (agent) do update set connection_id = excluded.connection_id,
      chat_id = excluded.chat_id, profile = excluded.profile, blocked = false, enabled_since = clock_timestamp();
  return true;
end;
$$;

create function telegram_disconnect(p_agent text)
returns void language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  delete from telegram_pairings where agent = p_agent;
  update telegram_accounts set chat_id = null, profile = null, blocked = false, connection_id = null
    where agent = p_agent;
end;
$$;

create function telegram_webhook(p_update bigint, p_chat text, p_profile text, p_token text, p_stop boolean)
returns boolean language plpgsql set search_path = public as $$
declare
  target text;
begin
  insert into telegram_updates (update_id) values (p_update) on conflict do nothing;
  if not found then return false; end if;
  if p_stop then
    for target in
      select agent from telegram_accounts where chat_id = p_chat
      union select agent from telegram_pairings where chat_id = p_chat order by 1
    loop
      perform pg_advisory_xact_lock(hashtextextended(target, 8008));
      delete from telegram_pairings where agent = target and chat_id = p_chat;
      update telegram_accounts set chat_id = null, profile = null, blocked = false, connection_id = null
        where agent = target and chat_id = p_chat;
    end loop;
    return true;
  end if;
  select agent into target from telegram_pairings where token_hash = p_token;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(target, 8008));
  update telegram_pairings set chat_id = p_chat, profile = p_profile where agent = target
    and token_hash = p_token and chat_id is null and expires_at > now();
  return found;
end;
$$;

create function telegram_set_preferences(p_agent text, p_enabled boolean, p_mode text, p_rule text, p_preference text)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  if p_rule is not null then
    if not exists (select 1 from rules where agent = p_agent and rule_id = p_rule::numeric
                   and template in (11, 12, 13) and status <> 'cancelled') then return false; end if;
    insert into telegram_rule_preferences (agent, rule_id, preference)
      select p_agent, p_rule::numeric, p_preference from telegram_accounts where agent = p_agent
      on conflict (agent, rule_id) do update set preference = excluded.preference, changed_at = clock_timestamp()
      where telegram_rule_preferences.preference is distinct from excluded.preference;
    return found or exists (select 1 from telegram_accounts where agent = p_agent);
  end if;
  update telegram_accounts set
    enabled_since = case when p_enabled is not null and enabled <> p_enabled then clock_timestamp() else enabled_since end,
    defaults_since = case when p_mode is not null and default_mode <> p_mode then clock_timestamp() else defaults_since end,
    enabled = coalesce(p_enabled, enabled), default_mode = coalesce(p_mode, default_mode)
    where agent = p_agent;
  return found;
end;
$$;

create function telegram_status(p_agent text, p_session text)
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
      where agent = p_agent and connection_id = a.connection_id and rule_id is null order by id desc limit 1),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('id', r.rule_id::text, 'template', r.template,
        'preference', coalesce(p.preference, 'inherit')) order by r.rule_id)
      from rules r left join telegram_rule_preferences p using (agent, rule_id)
      where r.agent = p_agent and r.template in (11, 12, 13) and r.status <> 'cancelled'), '[]'::jsonb)
  ) from (select p_agent as agent) requested left join telegram_accounts a using (agent);
$$;

create function telegram_destination(p_agent text, p_rule numeric, p_time timestamptz)
returns setof telegram_accounts language sql stable set search_path = public as $$
  select a.* from telegram_accounts a
    left join telegram_rule_preferences r on r.agent = a.agent and r.rule_id = p_rule
    where a.agent = p_agent and a.chat_id is not null and not a.blocked and (
      p_rule is null or (a.enabled and p_time > a.enabled_since and p_time > coalesce(r.changed_at, '-infinity')
        and (r.preference = 'send' or (coalesce(r.preference, 'inherit') = 'inherit'
          and a.default_mode = 'all' and p_time > a.defaults_since)))
    );
$$;

create function telegram_enqueue(p_agent text, p_chain int, p_tx text, p_index int,
    p_rule text, p_time timestamptz, p_message text)
returns boolean language plpgsql set search_path = public as $$
declare
  enqueued boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  if p_rule is null and exists (select 1 from telegram_deliveries d join telegram_accounts a
      on a.connection_id = d.connection_id where d.agent = p_agent and d.rule_id is null
      and d.created_at > now() - interval '1 minute') then return false; end if;
  insert into telegram_deliveries (agent, connection_id, chain_id, tx_hash, log_index, rule_id, block_time, message)
    select p_agent, connection_id, p_chain, p_tx, p_index, p_rule::numeric, p_time, p_message
    from telegram_destination(p_agent, p_rule::numeric, p_time)
    where p_rule is null or p_time > now() - interval '1 day'
    on conflict (chain_id, tx_hash, log_index) do nothing;
  enqueued := found;
  if p_rule is not null then
    update telegram_alert_outbox set processed_at = now() where chain_id = p_chain
      and tx_hash = p_tx and log_index = p_index and processed_at is null;
  end if;
  return enqueued;
end;
$$;

create function telegram_claim()
returns table (id text, lease uuid) language sql set search_path = public as $$
  update telegram_deliveries d set status = 'sending', attempts = attempts + 1,
    lease = gen_random_uuid(), due_at = now() + interval '60 seconds'
  where d.id = (select j.id from telegram_deliveries j
    where j.status in ('pending', 'sending') and j.due_at <= now()
    order by j.due_at, j.id limit 1 for update skip locked)
  returning d.id::text, d.lease;
$$;

create function telegram_prepare(p_id text, p_lease uuid)
returns table (chat_id text, message text, attempts int) language plpgsql set search_path = public as $$
declare
  delivery telegram_deliveries%rowtype;
  recipient text;
begin
  select * into delivery from telegram_deliveries where id = p_id::bigint
    and status = 'sending' and lease = p_lease and due_at > now();
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(delivery.agent, 8008));
  select a.chat_id into recipient from telegram_destination(delivery.agent, delivery.rule_id, delivery.block_time) a
    where a.connection_id = delivery.connection_id;
  if recipient is null or delivery.attempts > 12 or delivery.created_at <= now() - interval '1 day' then
    update telegram_deliveries d set status = case when recipient is null then 'cancelled' else 'failed' end, lease = null
      where d.id = delivery.id and d.lease = p_lease;
    return;
  end if;
  return query select recipient, delivery.message, delivery.attempts;
end;
$$;

create function telegram_finish(p_id text, p_lease uuid, p_result text, p_delay int)
returns void language plpgsql set search_path = public as $$
declare
  target text;
  connection uuid;
begin
  select agent into target from telegram_deliveries where id = p_id::bigint and lease = p_lease;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(target, 8008));
  update telegram_deliveries set status = case when p_result = 'retry' then 'pending'
      when p_result = 'sent' then 'sent' else 'failed' end,
    due_at = now() + make_interval(secs => p_delay), lease = null
    where id = p_id::bigint and lease = p_lease returning connection_id into connection;
  if p_result = 'blocked' and found then
    update telegram_accounts set blocked = true where agent = target and connection_id = connection;
  end if;
end;
$$;

create function telegram_maintain()
returns jsonb language plpgsql set search_path = public as $$
begin
  delete from telegram_sessions where expires_at <= now();
  delete from telegram_pairings where expires_at <= now();
  delete from telegram_updates where received_at <= now() - interval '7 days';
  delete from telegram_deliveries where status in ('sent', 'failed', 'cancelled')
    and created_at <= now() - interval '7 days';
  delete from telegram_alert_outbox where staged_at <= now() - interval '7 days';
  return (select jsonb_build_object('queued', count(*) filter (where status in ('pending', 'sending')),
    'oldestSeconds', coalesce(extract(epoch from now() - min(created_at) filter (where status in ('pending', 'sending')))::int, 0),
    'failed', count(*) filter (where status = 'failed'),
    'staged', (select count(*) from telegram_alert_outbox where processed_at is null),
    'oldestStagedSeconds', (select coalesce(extract(epoch from now() - min(staged_at))::int, 0)
      from telegram_alert_outbox where processed_at is null)) from telegram_deliveries);
end;
$$;

create function telegram_ready()
returns boolean language sql stable set search_path = public as $$
  select has_table_privilege('telegram_sessions', 'SELECT')
    and has_table_privilege('telegram_sessions', 'INSERT')
    and has_table_privilege('telegram_alert_outbox', 'INSERT')
    and has_table_privilege('telegram_deliveries', 'UPDATE')
    and has_function_privilege('telegram_status(text,text)', 'EXECUTE')
    and has_function_privilege('telegram_webhook(bigint,text,text,text,boolean)', 'EXECUTE')
    and has_function_privilege('telegram_pending_alerts()', 'EXECUTE')
    and has_function_privilege('telegram_claim()', 'EXECUTE')
    and exists (select 1 from pg_trigger where tgrelid = 'rule_events'::regclass
      and tgname = 'telegram_stage_event' and tgenabled in ('O', 'A'));
$$;

-- Supabase exposes public-schema RPCs by default. Grant these only to its backend service role.
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
      where pronamespace = 'public'::regnamespace and left(proname, 9) = 'telegram_'
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

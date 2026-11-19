-- Reuse the existing outbox and delivery identity for confirmed destination executions.
alter table executions add column telegram_notify boolean not null default false;
alter table telegram_alert_outbox alter column template drop not null,
  alter column observed drop not null, add column execution jsonb;

create function telegram_stage_execution()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into telegram_alert_outbox (chain_id, tx_hash, log_index, agent, rule_id, block_time, execution)
    values (new.chain_id, new.tx_hash, new.log_index, new.agent, new.rule_id, new.block_time,
      jsonb_build_object('kind', new.kind, 'vault', new.vault, 'tokenIn', new.token_in,
        'tokenOut', new.token_out, 'amountIn', new.amount_in::text, 'amountOut', new.amount_out::text))
    on conflict (chain_id, tx_hash, log_index) do nothing;
  return new;
end;
$$;

-- Live indexing supplies telegram_notify. Existing receipts and reindex writes stay silent.
create trigger telegram_stage_confirmed_execution after insert on executions
  for each row when (new.telegram_notify and new.status = 'confirmed')
  execute function telegram_stage_execution();

create or replace function telegram_pending_alerts()
returns table (chain_id int, tx_hash text, log_index int, agent text, rule_id text, template smallint,
    observed text, block_time timestamptz) language sql stable set search_path = public as $$
  select a.chain_id, a.tx_hash, a.log_index, a.agent, a.rule_id::text, a.template, a.observed::text, a.block_time
    from telegram_alert_outbox a where a.processed_at is null and a.execution is null
    order by a.staged_at, a.chain_id, a.tx_hash, a.log_index limit 25;
$$;

create function telegram_pending_notifications()
returns table (chain_id int, tx_hash text, log_index int, agent text, rule_id text, template smallint,
    observed text, block_time timestamptz, execution jsonb, eligible boolean)
language sql stable set search_path = public as $$
  select a.chain_id, a.tx_hash, a.log_index, a.agent, a.rule_id::text, coalesce(a.template, r.template),
    a.observed::text, a.block_time, a.execution,
    a.block_time > now() - interval '1 day'
      and exists (select 1 from telegram_destination(a.agent, a.rule_id, a.block_time))
    from telegram_alert_outbox a left join rules r using (agent, rule_id)
    where a.processed_at is null order by a.staged_at, a.chain_id, a.tx_hash, a.log_index limit 25;
$$;

create or replace function telegram_set_preferences(p_agent text, p_enabled boolean, p_mode text, p_rule text, p_preference text)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_agent, 8008));
  if p_rule is not null then
    if not exists (select 1 from rules where agent = p_agent and rule_id = p_rule::numeric
                   and status <> 'cancelled') then return false; end if;
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

create function telegram_notification_status(p_agent text, p_session text)
returns jsonb language sql stable set search_path = public as $$
  select telegram_status(p_agent, p_session) || jsonb_build_object('rules', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.rule_id::text, 'template', r.template,
      'preference', coalesce(p.preference, 'inherit')) order by r.rule_id)
    from rules r left join telegram_rule_preferences p using (agent, rule_id)
    where r.agent = p_agent and r.status <> 'cancelled'), '[]'::jsonb));
$$;

create or replace function telegram_enqueue(p_agent text, p_chain int, p_tx text, p_index int,
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

create function telegram_notifications_ready()
returns boolean language sql stable set search_path = public as $$
  select telegram_ready()
    and has_function_privilege('telegram_notification_status(text,text)', 'EXECUTE')
    and has_function_privilege('telegram_pending_notifications()', 'EXECUTE')
    and exists (select 1 from pg_trigger where tgrelid = 'executions'::regclass
      and tgname = 'telegram_stage_confirmed_execution' and tgenabled in ('O', 'A'));
$$;

do $$
declare
  routine regprocedure;
  role_name text;
begin
  foreach routine in array array['telegram_stage_execution()'::regprocedure,
    'telegram_pending_notifications()'::regprocedure, 'telegram_notification_status(text,text)'::regprocedure,
    'telegram_notifications_ready()'::regprocedure] loop
    execute format('revoke all on function %s from public', routine);
    for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
      execute format('revoke all on function %s from %I', routine, role_name);
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', routine);
    end if;
  end loop;
end;
$$;

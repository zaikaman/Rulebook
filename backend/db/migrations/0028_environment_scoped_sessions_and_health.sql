-- Scope Bookkeeper and Rulewright sessions and Bookkeeper conversations to network mode
-- ('testnet' | 'mainnet'), and key workflow_v2_health by (chain, workflow_id) so reused
-- workflowIds across settlement Vaults never mask each other.

alter table assistant_sessions
  add column network text not null default 'testnet'
  check (network in ('testnet', 'mainnet'));

alter table assistant_conversations
  add column network text not null default 'testnet'
  check (network in ('testnet', 'mainnet'));

create index assistant_conversations_owner_network_idx
  on assistant_conversations (owner, network, updated_at desc);

alter table rulewright_sessions
  add column network text not null default 'testnet'
  check (network in ('testnet', 'mainnet'));

drop function assistant_admit(text, text, uuid, text);
create function assistant_admit(
  p_session text,
  p_origin text,
  p_conversation uuid,
  p_message text,
  p_network text default 'testnet'
)
returns jsonb language plpgsql set search_path = public as $$
declare
  wallet text;
  conversation uuid;
  prior jsonb;
  day_start timestamptz := date_trunc('day', now(), 'UTC');
begin
  if p_network not in ('testnet', 'mainnet') then
    return jsonb_build_object('status', 'unauthorized');
  end if;

  select owner into wallet from assistant_sessions
    where token_hash = p_session
      and origin = p_origin
      and network = p_network
      and (expires_at is null or expires_at > now());
  if wallet is null then return jsonb_build_object('status', 'unauthorized'); end if;

  perform pg_advisory_xact_lock(hashtextextended(wallet, 16002));

  if (select count(*) from assistant_messages m
        join assistant_conversations c on c.id = m.conversation_id
        where c.owner = wallet and m.role = 'user' and m.created_at >= day_start) >= 80
    or (select count(*) from assistant_messages
        where role = 'user' and created_at >= day_start) >= 3000 then
    return jsonb_build_object('status', 'limited');
  end if;

  if p_conversation is not null then
    select id into conversation from assistant_conversations
      where id = p_conversation and owner = wallet and network = p_network;
    if conversation is null then return jsonb_build_object('status', 'missing'); end if;
  else
    insert into assistant_conversations (owner, origin, network)
      values (wallet, p_origin, p_network) returning id into conversation;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content) order by id), '[]'::jsonb)
    into prior
    from (
      select id, role, content from assistant_messages
        where conversation_id = conversation
        order by id desc limit 12
    ) recent;

  insert into assistant_messages (conversation_id, role, content)
    values (conversation, 'user', p_message);
  update assistant_conversations set updated_at = now() where id = conversation;

  return jsonb_build_object(
    'status', 'ok',
    'owner', wallet,
    'conversation', conversation,
    'history', prior
  );
end;
$$;

drop function rulewright_enqueue(text, text, jsonb);
create function rulewright_enqueue(
  p_session text,
  p_origin text,
  p_payload jsonb,
  p_network text default 'testnet'
)
returns jsonb language plpgsql set search_path = public as $$
declare
  wallet text;
  job_id uuid;
  day_start timestamptz := date_trunc('day', now(), 'UTC');
begin
  if p_network not in ('testnet', 'mainnet') then
    return jsonb_build_object('status', 'unauthorized');
  end if;

  perform pg_advisory_xact_lock(16001);
  select owner into wallet from rulewright_sessions
    where token_hash = p_session
      and origin = p_origin
      and network = p_network
      and expires_at > now();
  if wallet is null then return jsonb_build_object('status', 'unauthorized'); end if;

  if (select count(*) from rulewright_jobs where requested_at >= day_start) >= 250
    or (select count(*) from rulewright_jobs where requested_at >= day_start and owner = wallet) >= 20 then
    return jsonb_build_object('status', 'limited');
  end if;
  if (select count(*) from rulewright_jobs where payload is not null and expires_at > now()) >= 6 then
    return jsonb_build_object('status', 'busy');
  end if;

  insert into rulewright_jobs (owner, session_hash, payload) values (wallet, p_session, p_payload)
    returning id into job_id;
  return jsonb_build_object('status', 'queued', 'id', job_id);
end;
$$;

drop function workflow_v2_health(text, text, integer[]);
create function workflow_v2_health(p_deployment text, p_owner text, p_chains integer[] default null)
returns table (
  chain integer,
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
    select distinct on (chain, workflow_id) *
    from workflow_v2_activity
    where deployment = p_deployment and owner = p_owner
      and (p_chains is null or chain = any(p_chains))
    order by chain, workflow_id, lasna_block desc, id desc
  ),
  success as (
    select distinct on (chain, workflow_id) *
    from workflow_v2_activity
    where deployment = p_deployment and owner = p_owner
      and (p_chains is null or chain = any(p_chains))
      and status = 'confirmed'
    order by chain, workflow_id, lasna_block desc, id desc
  ),
  pending as (
    select distinct on (chain, workflow_id) *
    from workflow_v2_activity
    where deployment = p_deployment and owner = p_owner
      and (p_chains is null or chain = any(p_chains))
      and status = 'pending'
    order by chain, workflow_id, lasna_block desc, id desc
  )
  select
    latest.chain,
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
  left join success using (chain, workflow_id)
  left join pending using (chain, workflow_id);
$$;

do $$
declare
  target record;
  role_name text;
begin
  for target in
    select 'function' as kind, oid::regprocedure::text as name from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('assistant_admit', 'rulewright_enqueue', 'workflow_v2_health')
  loop
    execute format('revoke all on %s %s from public', target.kind, target.name);
    for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
      execute format('revoke all on %s %s from %I', target.kind, target.name, role_name);
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on %s %s to service_role', target.kind, target.name);
    end if;
  end loop;
end;
$$;

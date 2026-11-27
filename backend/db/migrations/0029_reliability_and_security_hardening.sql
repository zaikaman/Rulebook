-- Reliability, cursor reorg tracking, and Bookkeeper session/message hardening.

alter table workflow_v2_cursors
  add column if not exists block_hash text,
  add column if not exists updated_at timestamptz not null default now();

drop function if exists assistant_admit(text, text, uuid, text, text);
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
  user_message_id bigint;
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
    values (conversation, 'user', p_message)
    returning id into user_message_id;
  update assistant_conversations set updated_at = now() where id = conversation;

  return jsonb_build_object(
    'status', 'ok',
    'owner', wallet,
    'conversation', conversation,
    'message_id', user_message_id,
    'history', prior
  );
end;
$$;

create or replace function assistant_rollback(
  p_conversation uuid,
  p_owner text,
  p_message_id bigint
)
returns boolean language plpgsql set search_path = public as $$
declare
  deleted_count int;
begin
  if not exists (
    select 1 from assistant_conversations where id = p_conversation and owner = p_owner
  ) then
    return false;
  end if;
  if exists (
    select 1 from assistant_messages
      where conversation_id = p_conversation and id > p_message_id
  ) then
    return false;
  end if;
  delete from assistant_messages
    where id = p_message_id and conversation_id = p_conversation and role = 'user';
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

create or replace function assistant_revoke(p_session text, p_origin text)
returns boolean language plpgsql set search_path = public as $$
declare
  deleted_count int;
begin
  delete from assistant_sessions
    where token_hash = p_session and origin = p_origin;
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
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
      and proname in ('assistant_admit', 'assistant_rollback', 'assistant_revoke')
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

-- Guests can read public testnet account data. Keep every guest conversation scoped
-- to the bearer session that created it, even though guests inspect the same owner.

alter table assistant_sessions
  add column demo boolean not null default false,
  add constraint assistant_demo_session_testnet
    check (not demo or (network = 'testnet' and token_hash is not null and expires_at is not null));

alter table assistant_conversations add column demo_session_hash text;
create index assistant_conversations_demo_session_idx
  on assistant_conversations (demo_session_hash) where demo_session_hash is not null;

create or replace function assistant_admit(
  p_session text,
  p_origin text,
  p_conversation uuid,
  p_message text,
  p_network text default 'testnet'
)
returns jsonb language plpgsql set search_path = public as $$
declare
  wallet text;
  is_demo boolean;
  demo_scope text;
  conversation uuid;
  prior jsonb;
  user_message_id bigint;
  day_start timestamptz := date_trunc('day', now(), 'UTC');
begin
  if p_network not in ('testnet', 'mainnet') then
    return jsonb_build_object('status', 'unauthorized');
  end if;

  select owner, demo into wallet, is_demo from assistant_sessions
    where token_hash = p_session
      and origin = p_origin
      and network = p_network
      and (expires_at is null or expires_at > now());
  if wallet is null then return jsonb_build_object('status', 'unauthorized'); end if;

  demo_scope := case when is_demo then p_session end;
  perform pg_advisory_xact_lock(hashtextextended(wallet || case when is_demo then ':demo' else '' end, 16002));

  if (select count(*) from assistant_messages m
        join assistant_conversations c on c.id = m.conversation_id
        where c.owner = wallet and (c.demo_session_hash is not null) = is_demo
          and m.role = 'user' and m.created_at >= day_start) >= 80
    or (is_demo and (select count(*) from assistant_messages m
        join assistant_conversations c on c.id = m.conversation_id
        where c.demo_session_hash = demo_scope
          and m.role = 'user' and m.created_at >= day_start) >= 12)
    or (select count(*) from assistant_messages
        where role = 'user' and created_at >= day_start) >= 3000 then
    return jsonb_build_object('status', 'limited');
  end if;

  if p_conversation is not null then
    select id into conversation from assistant_conversations
      where id = p_conversation and owner = wallet and network = p_network
        and demo_session_hash is not distinct from demo_scope;
    if conversation is null then return jsonb_build_object('status', 'missing'); end if;
  else
    insert into assistant_conversations (owner, origin, network, demo_session_hash)
      values (wallet, p_origin, p_network, demo_scope) returning id into conversation;
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
  ) || case when is_demo then jsonb_build_object('demo', true) else '{}'::jsonb end;
end;
$$;

-- Bookkeeper conversations are private wallet data. Sessions are created from a wallet signature,
-- admission is serialized per owner, and every query runs with the backend service role.
create table assistant_sessions (
  nonce text primary key,
  owner text not null,
  origin text not null,
  token_hash text unique,
  expires_at timestamptz not null
);
create index assistant_sessions_expiry_idx on assistant_sessions (expires_at);

create table assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  origin text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assistant_conversations_owner_idx on assistant_conversations (owner, updated_at desc);
create index assistant_conversations_updated_idx on assistant_conversations (updated_at);

create table assistant_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references assistant_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tools jsonb,
  created_at timestamptz not null default now()
);
create index assistant_messages_conversation_idx on assistant_messages (conversation_id, id);
create index assistant_messages_day_idx on assistant_messages (created_at, role);

alter table assistant_sessions enable row level security;
alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;
revoke all on assistant_sessions, assistant_conversations, assistant_messages
  from public, anon, authenticated;
grant select, insert, update, delete
  on assistant_sessions, assistant_conversations, assistant_messages to service_role;
grant usage, select on sequence assistant_messages_id_seq to service_role;

-- Validates the wallet session, creates or resumes a conversation, records the user message, and
-- returns the recent turns the model may use. The daily quota counts only user messages.
create function assistant_admit(
  p_session text, p_origin text, p_conversation uuid, p_message text
)
returns jsonb language plpgsql set search_path = public as $$
declare
  wallet text;
  conversation uuid;
  prior jsonb;
  day_start timestamptz := date_trunc('day', now(), 'UTC');
begin
  select owner into wallet from assistant_sessions
    where token_hash = p_session and origin = p_origin and expires_at > now();
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
      where id = p_conversation and owner = wallet;
    if conversation is null then return jsonb_build_object('status', 'missing'); end if;
  else
    insert into assistant_conversations (owner, origin)
      values (wallet, p_origin) returning id into conversation;
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

-- Messages stay for the conversation retention window so the daily quota is never bypassed by
-- trimming history. The model only ever reads the newest twelve messages, which assistant_admit selects.
create function assistant_finish(
  p_conversation uuid, p_owner text, p_content text, p_tools jsonb default null
)
returns boolean language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from assistant_conversations where id = p_conversation and owner = p_owner
  ) then return false; end if;
  if char_length(p_content) = 0 then return false; end if;

  insert into assistant_messages (conversation_id, role, content, tools)
    values (p_conversation, 'assistant', p_content, p_tools);
  update assistant_conversations set updated_at = now() where id = p_conversation;
  return true;
end;
$$;

create function assistant_cleanup()
returns void language plpgsql set search_path = public as $$
begin
  delete from assistant_sessions where expires_at <= now();
  delete from assistant_conversations where updated_at < now() - interval '30 days';
end;
$$;

revoke execute on function assistant_admit(text, text, uuid, text),
  assistant_finish(uuid, text, text, jsonb), assistant_cleanup()
  from public, anon, authenticated;
grant execute on function assistant_admit(text, text, uuid, text),
  assistant_finish(uuid, text, text, jsonb), assistant_cleanup()
  to service_role;

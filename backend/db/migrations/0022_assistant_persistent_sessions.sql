-- Bookkeeper sessions remain valid until the client discards the token. Only unsigned signing
-- challenges expire; sessions are identified by a token hash and have no expiry.
alter table assistant_sessions alter column expires_at drop not null;

-- Preserve sessions that are still active when this migration runs.
update assistant_sessions
  set expires_at = null
  where token_hash is not null and expires_at > now();

create or replace function assistant_admit(
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
    where token_hash = p_session and origin = p_origin
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

create or replace function assistant_cleanup()
returns void language plpgsql set search_path = public as $$
begin
  delete from assistant_sessions where expires_at is not null and expires_at <= now();
  delete from assistant_conversations where updated_at < now() - interval '30 days';
end;
$$;

revoke execute on function assistant_admit(text, text, uuid, text),
  assistant_finish(uuid, text, text, jsonb), assistant_cleanup()
  from public, anon, authenticated;
grant execute on function assistant_admit(text, text, uuid, text),
  assistant_finish(uuid, text, text, jsonb), assistant_cleanup()
  to service_role;

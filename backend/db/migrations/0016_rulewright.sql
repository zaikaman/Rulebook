create table rulewright_sessions (
  nonce text primary key,
  owner text not null,
  origin text not null,
  token_hash text unique,
  expires_at timestamptz not null
);

create table rulewright_jobs (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  session_hash text not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  payload jsonb,
  result jsonb,
  lease uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0
);

create index rulewright_jobs_pending_idx on rulewright_jobs (requested_at) where payload is not null;
create index rulewright_sessions_expiry_idx on rulewright_sessions (expires_at);

alter table rulewright_sessions enable row level security;
alter table rulewright_jobs enable row level security;
revoke all on rulewright_sessions, rulewright_jobs from public, anon, authenticated;
grant select, insert, update, delete on rulewright_sessions, rulewright_jobs to service_role;

-- Serialize admission across dynos, including the decision to consume a daily quota slot.
create function rulewright_enqueue(p_session text, p_origin text, p_payload jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  wallet text;
  job_id uuid;
  day_start timestamptz := date_trunc('day', now(), 'UTC');
begin
  perform pg_advisory_xact_lock(16001);
  select owner into wallet from rulewright_sessions
    where token_hash = p_session and origin = p_origin and expires_at > now();
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

create function rulewright_claim()
returns table (id uuid, lease uuid, payload jsonb) language plpgsql set search_path = public as $$
begin
  return query
    with candidate as (
      select j.id from rulewright_jobs j
      where j.payload is not null and j.expires_at > now() and j.attempts < 2
        and (j.lease_expires_at is null or j.lease_expires_at <= now())
      order by j.requested_at, j.id limit 1 for update skip locked
    )
    update rulewright_jobs j set lease = gen_random_uuid(),
      lease_expires_at = now() + interval '90 seconds', attempts = j.attempts + 1
    from candidate where j.id = candidate.id returning j.id, j.lease, j.payload;
end;
$$;

-- Retain today's admission records for quota enforcement, and clear conversation data promptly.
create function rulewright_cleanup()
returns void language plpgsql set search_path = public as $$
begin
  delete from rulewright_sessions where expires_at <= now();
  delete from rulewright_jobs where requested_at < date_trunc('day', now(), 'UTC')
    and expires_at <= now();
  update rulewright_jobs set payload = null, result = null, lease = null, lease_expires_at = null
    where expires_at <= now() and (payload is not null or result is not null);
  update rulewright_jobs set payload = null, lease = null, lease_expires_at = null,
    result = '{"type":"error","message":"Drafting was interrupted. Try again."}'::jsonb
    where payload is not null and attempts >= 2 and lease_expires_at <= now();
end;
$$;

revoke execute on function rulewright_enqueue(text, text, jsonb), rulewright_claim(), rulewright_cleanup()
  from public, anon, authenticated;
grant execute on function rulewright_enqueue(text, text, jsonb), rulewright_claim(), rulewright_cleanup()
  to service_role;

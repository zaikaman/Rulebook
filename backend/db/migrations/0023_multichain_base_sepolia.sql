-- Allow telegram_claim_funding to join Vault rows for any requested funds chain (e.g. Base Sepolia 84532)
-- instead of hardcoding Unichain Sepolia (1301).
create or replace function telegram_claim_funding(p_deployment text, p_chain int, p_limit int)
returns jsonb language plpgsql set search_path = public as $$
declare
  result jsonb;
begin
  -- Seed a bounded number of jobs. The joins only use accounts from the configured factories.
  insert into telegram_funding_checks (deployment, agent, chain)
  select p_deployment, a.agent, p_chain
  from telegram_accounts a
  join workflow_v2_accounts w on w.deployment = p_deployment and w.chain = 5318007 and w.address = a.agent
  where a.chat_id is not null and not a.blocked and a.enabled and a.funding_alerts
    and (p_chain = 5318007 or exists (select 1 from workflow_v2_accounts v
      where v.deployment = p_deployment and v.chain = p_chain and v.owner = w.owner and v.agent = w.address))
    and exists (select 1 from workflow_v2_activations e where e.deployment = p_deployment and e.agent = a.agent)
    and not exists (select 1 from telegram_funding_checks f where f.deployment = p_deployment
      and f.agent = a.agent and f.chain = p_chain)
  order by a.agent limit p_limit on conflict do nothing;
  with candidates as (
    select f.deployment, f.agent, f.chain, v.address as vault
    from telegram_funding_checks f join telegram_accounts a using (agent)
    join workflow_v2_accounts w on w.deployment = f.deployment and w.chain = 5318007 and w.address = f.agent
    left join workflow_v2_accounts v on v.deployment = f.deployment and v.chain = p_chain
      and v.owner = w.owner and v.agent = w.address
    where f.deployment = p_deployment and f.chain = p_chain and f.due_at <= now()
      and a.chat_id is not null and not a.blocked and a.enabled and a.funding_alerts
      and (p_chain = 5318007 or v.address is not null)
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

revoke all on function telegram_claim_funding(text, int, int) from public;
-- Include chain in payout warning alert_data so preflight queries the right Vault RPC.
create or replace function telegram_queue_payout_warnings(p_deployment text)
returns void language sql set search_path = public as $$
  insert into telegram_deliveries (agent, connection_id, chain_id, workflow_id,
    block_time, message, alert_kind, alert_data, alert_key)
  select w.agent, a.connection_id, w.chain, w.workflow_id, clock_timestamp(), w.message, 'payout',
    jsonb_build_object('kind', 'payout', 'chain', w.chain, 'vault', w.vault,
      'workflow', w.workflow_id, 'epoch', w.epoch, 'deadline', w.deadline,
      'block', w.block_number::text, 'deployment', w.deployment),
    k.delivery_key
  from telegram_payout_windows w
  cross join lateral telegram_alert_destination(w.agent, 'payout', clock_timestamp()) a
  cross join lateral (select concat_ws(':', w.deployment, w.agent, w.workflow_id, w.epoch, w.deadline,
    a.connection_id, extract(epoch from a.enabled_since), extract(epoch from a.action_since)) as delivery_key) k
  where w.deployment = p_deployment and w.deadline > extract(epoch from now())
    and not exists (select 1 from telegram_deliveries d where d.alert_key = k.delivery_key)
  order by w.deadline limit 25 on conflict (alert_key) do nothing;
$$;

revoke all on function telegram_queue_payout_warnings(text) from public;
do $$
declare
  role_name text;
begin
  for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
    execute format('revoke all on function telegram_claim_funding(text, int, int) from %I', role_name);
    execute format('revoke all on function telegram_queue_payout_warnings(text) from %I', role_name);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on function telegram_claim_funding(text, int, int) to service_role';
    execute 'grant all on function telegram_queue_payout_warnings(text) to service_role';
  end if;
end;
$$;

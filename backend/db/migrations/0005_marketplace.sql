-- Phase 8: public listings, marketplace statistics, and the leaderboard.
--
-- A listing is identified by the rule it publishes, not by a global counter: `listing_id`
-- equals the per-agent `ruleId`, so two agents can each list rule 1. The primary key therefore
-- has to include the agent.
alter table listings drop constraint if exists listings_pkey;
alter table listings add column if not exists params_hash text;
alter table listings add column if not exists name text;
alter table listings add column if not exists description text;
alter table listings add constraint listings_pkey primary key (chain_id, agent, rule_id);

create index if not exists listings_public_time_idx
  on listings (created_at desc) where is_public;

-- Statistics come only from executions (FR-040). A rule that never executed has no row here
-- and is rendered with zero runs by the API, never with a self-reported value.
create or replace view rule_stats as
select
  agent,
  rule_id,
  count(*)::int as runs,
  case
    when count(*) = 0 then 0::numeric
    else (count(*) filter (where status = 'confirmed'))::numeric / count(*)
  end as success_rate,
  avg(amount_in) filter (where amount_in is not null) as avg_amount_in
from executions
group by agent, rule_id;

-- The marketplace feed: live listings joined to the stored rule and its execution statistics.
create or replace view marketplace_feed as
select
  l.chain_id,
  l.listing_id,
  l.agent,
  l.rule_id,
  l.template,
  l.metadata_uri,
  l.author,
  l.author_badge,
  l.name,
  l.description,
  l.params_hash,
  l.created_at,
  r.status as rule_status,
  r.runs as recorded_runs,
  coalesce(s.runs, 0) as runs,
  coalesce(s.success_rate, 0) as success_rate,
  coalesce(s.avg_amount_in, 0) as avg_amount_in
from listings l
left join rules r on r.agent = l.agent and r.rule_id = l.rule_id
left join rule_stats s on s.agent = l.agent and s.rule_id = l.rule_id
where l.is_public;

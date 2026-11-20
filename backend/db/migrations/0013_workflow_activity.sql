create index workflow_decisions_activity on workflow_decisions (agent, lasna_block desc, id desc);

create function list_workflow_activity(
  wallet_owner text, attention_only boolean, after_block bigint, after_run text, page_size integer
) returns table (id text, workflow_id text, title text, lasna_block bigint, status text)
language sql stable set search_path = public as $$
  select d.id, d.workflow_id, a.title, d.lasna_block,
    case
      when d.skipped then 'Skipped'
      when o.completed then 'Completed'
      when o.completed = false then 'Failed'
      when d.expires_at <= extract(epoch from statement_timestamp()) then 'No result confirmed'
      else 'Waiting for confirmation'
    end
  from workflow_agents owner_agent
  join workflow_decisions d on d.agent = owner_agent.address
  left join workflow_activations a on a.agent = d.agent and a.workflow_id = d.workflow_id
    and a.epoch = d.epoch and a.program_hash = d.program_hash
  left join workflow_verified_outcomes o on o.id = d.id
  where owner_agent.owner = wallet_owner
    and (after_run is null or (d.lasna_block, d.id) < (after_block, after_run))
    and (not attention_only or (not d.skipped and
      coalesce(not o.completed, d.expires_at <= extract(epoch from statement_timestamp()))))
  order by d.lasna_block desc, d.id desc
  limit page_size;
$$;
revoke all on function list_workflow_activity(text,boolean,bigint,text,integer) from public, anon, authenticated;
grant execute on function list_workflow_activity(text,boolean,bigint,text,integer) to service_role;

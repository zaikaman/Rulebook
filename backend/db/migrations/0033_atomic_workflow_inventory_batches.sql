create function workflow_v2_apply_inventory_batch(
  p_deployment text, p_chain integer, p_expected_block bigint, p_expected_hash text,
  p_block bigint, p_hash text, p_events jsonb
) returns boolean language plpgsql volatile set search_path = public as $$
declare
  current_block bigint;
  current_hash text;
begin
  perform pg_advisory_xact_lock(hashtext(p_deployment), p_chain);
  select c.block_number, c.block_hash into current_block, current_hash
  from workflow_v2_inventory_cursors c
  where c.deployment = p_deployment and c.chain = p_chain;

  if current_block is distinct from p_expected_block or current_hash is distinct from p_expected_hash then
    return false;
  end if;

  if p_events is null then
    if current_block is null or p_block >= current_block then
      raise exception 'Invalid workflow inventory rewind.';
    end if;
    delete from workflow_v2_authorization_events e
    where e.deployment = p_deployment and e.chain = p_chain and e.block_number > p_block;
  else
    if p_hash is null or (current_block is not null and p_block <= current_block) then
      raise exception 'Invalid workflow inventory batch.';
    end if;
    insert into workflow_v2_authorization_events (deployment, chain, vault, workflow_id, epoch, block_number, log_index)
    select p_deployment, p_chain, e.vault, e.workflow_id, e.epoch, e.block_number, e.log_index
    from jsonb_to_recordset(p_events) as e(vault text, workflow_id text, epoch numeric, block_number bigint, log_index integer)
    where (current_block is null or e.block_number > current_block) and e.block_number <= p_block;
  end if;

  insert into workflow_v2_inventory_cursors (deployment, chain, block_number, block_hash)
  values (p_deployment, p_chain, p_block, p_hash)
  on conflict (deployment, chain) do update
    set block_number = excluded.block_number, block_hash = excluded.block_hash;
  return true;
end;
$$;

revoke all on function workflow_v2_apply_inventory_batch(text, integer, bigint, text, bigint, text, jsonb) from public;

do $$
declare
  role_name text;
begin
  for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
    execute format('revoke all on function workflow_v2_apply_inventory_batch(text, integer, bigint, text, bigint, text, jsonb) from %I', role_name);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function workflow_v2_apply_inventory_batch(text, integer, bigint, text, bigint, text, jsonb) to service_role;
  end if;
end;
$$;

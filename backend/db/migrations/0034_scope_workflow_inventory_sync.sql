create or replace function workflow_v2_inventory_page(
  p_deployment text, p_owner text, p_chains integer[], p_archived boolean,
  p_cursor_chain integer, p_cursor_id text, p_before boolean, p_limit integer
) returns jsonb language sql stable set search_path = public as $$
  with vaults as materialized (
    select v.deployment, v.chain, v.address, v.owner
    from workflow_v2_accounts v
    where v.deployment = p_deployment and v.owner = p_owner and v.chain = any(p_chains)
  ), eligible as materialized (
    select v.chain, w.workflow_id as id
    from vaults v
    cross join lateral (
      select distinct on (e.workflow_id) e.workflow_id, e.epoch
      from workflow_v2_authorization_events e
      where (e.deployment, e.chain, e.vault) = (v.deployment, v.chain, v.address)
      order by e.workflow_id, e.epoch desc
    ) w
    left join lateral (
      select a.archived, a.epoch from workflow_v2_archive_events a
      where (a.deployment, a.chain, a.owner, a.workflow_id) =
        (v.deployment, v.chain, v.owner, w.workflow_id)
      order by a.revision desc limit 1
    ) a on true
    where coalesce(a.archived and a.epoch = w.epoch, false) = p_archived
  ), page as (
    select e.chain, e.id from eligible e
    where p_cursor_id is null
      or (p_before and (e.chain, e.id) < (p_cursor_chain, p_cursor_id))
      or (not p_before and (e.chain, e.id) > (p_cursor_chain, p_cursor_id))
    order by case when p_before then e.chain end desc, case when p_before then e.id end desc,
      e.chain, e.id
    limit p_limit
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page) order by
      case when p_before then page.chain end desc, case when p_before then page.id end desc,
      page.chain, page.id) from page), '[]'::jsonb),
    'total', (select count(*) from eligible),
    'syncing', exists (
      select 1 from vaults v
      left join workflow_v2_cursors c on c.deployment = v.deployment and c.chain = v.chain
      left join workflow_v2_inventory_cursors i on i.deployment = v.deployment and i.chain = v.chain
      -- The activity and inventory workers poll independently. Allow ordinary cursor drift.
      where c.block_number is null or i.block_number is null or c.block_number - i.block_number > 64
    )
  );
$$;

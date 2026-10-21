begin;

-- These read-only reports join materialized inventory/assignment tables. A
-- failed canonical stage has not changed those tables; use the same audited
-- publication proof as ordinary inventory reads. Actor authorization, source
-- revision comparisons and all write fences remain in their existing bodies.
do $migration$
declare
  patch record;
  function_oid oid;
  definition text;
begin
  for patch in select * from (values
    ('public.manager_report_read_v2(jsonb)',
      $old$select bool_and(state='ready') from public.app_dataset_revisions$old$,
      $new$select bool_and(state='ready' or coalesce((app_sync_private.published_snapshot_read_proof(key,revision)->>'publishedReadable')::boolean,false)) from public.app_dataset_revisions$new$),
    ('public.manager_ncr_outbox_metadata_v1(text,text)',
      $old$from public.app_dataset_revisions where key='ph_master_inventory' and state='ready';$old$,
      $new$from public.app_dataset_revisions where key='ph_master_inventory'
    and (state='ready' or coalesce((app_sync_private.published_snapshot_read_proof(key,revision)->>'publishedReadable')::boolean,false));$new$),
    ('private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)',
      $old$where r.key is null or r.state<>'ready') then$old$,
      $new$where r.key is null or (r.state<>'ready'
      and not coalesce((app_sync_private.published_snapshot_read_proof(r.key,r.revision)->>'publishedReadable')::boolean,false))) then$new$),
    ('private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)',
      $old$'inventoryState','ready','inventoryRowCount'$old$,
      $new$'inventoryState',(select state from public.app_dataset_revisions where key='ph_master_inventory'),
      'publishedReadable',coalesce((select (app_sync_private.published_snapshot_read_proof(key,revision)->>'publishedReadable')::boolean
        from public.app_dataset_revisions where key='ph_master_inventory'),false),'inventoryRowCount'$new$),
    ('private.manager_report_enrich_location_on_hand_v1(jsonb,boolean)',
      $old$if source_revision is null or source_state is distinct from 'ready' then$old$,
      $new$if source_revision is null or (source_state is distinct from 'ready'
    and not coalesce((app_sync_private.published_snapshot_read_proof('ph_master_inventory',source_revision::bigint)->>'publishedReadable')::boolean,false)) then$new$)
  ) as patches(signature, old_gate, new_gate)
  loop
    function_oid := to_regprocedure(patch.signature);
    if function_oid is null then raise exception 'MANAGER_PUBLISHED_READ_FUNCTION_MISSING: %',patch.signature; end if;
    definition := pg_get_functiondef(function_oid);
    if position(patch.new_gate in definition)=0 then
      if (length(definition)-length(replace(definition,patch.old_gate,''))) / length(patch.old_gate) <> 1 then
        raise exception 'MANAGER_PUBLISHED_READ_ANCHOR_INVALID: %',patch.signature;
      end if;
      execute replace(definition,patch.old_gate,patch.new_gate);
    end if;
    if position(patch.new_gate in pg_get_functiondef(function_oid))=0 then
      raise exception 'MANAGER_PUBLISHED_READ_CONTRACT_INVALID: %',patch.signature;
    end if;
  end loop;
end
$migration$;

commit;

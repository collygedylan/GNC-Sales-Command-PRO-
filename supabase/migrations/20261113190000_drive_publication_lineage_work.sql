begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- Keep wide canonical inventory rows out of identity discovery. The certified
-- stage remains the source of truth and is materialized only for these joins.
create function private.prepare_drive_lineage_work_v3082()
returns void language plpgsql set search_path='' as $work$
begin
  create temp table staged_lineage_v3082 on commit drop as
    select unique_id,row_number,lineage_key,raw_values,priority,ptronhand
    from pg_temp.ph_master_bulk_stage_v1;
  create unique index on staged_lineage_v3082(unique_id);
  create unique index on staged_lineage_v3082(row_number);
  analyze pg_temp.staged_lineage_v3082;

  create temp table live_lineage_v3082 on commit drop as
    select unique_id from public.ph_master_inventory;
  create unique index on live_lineage_v3082(unique_id);
  analyze pg_temp.live_lineage_v3082;
end
$work$;

create function private.compiled_drive_prior_aliases_v3082()
returns table(row_number bigint,canonical_unique_id text)
language plpgsql stable set search_path='' set enable_nestloop=off as $alias$
begin
  return query with aliases as materialized (
    select source.source_unique_id,source.canonical_unique_id
    from app_sync_private.ph_master_bulk_import_source_v1 source
    where source.source_unique_id<>source.canonical_unique_id
  ), candidates as (
    select s.row_number,a.canonical_unique_id,count(*) over(partition by s.row_number) matches
    from aliases a
    join pg_temp.staged_lineage_v3082 s on s.unique_id=a.source_unique_id
    join app_sync_private.ph_master_inventory_source_baselines b
      on b.canonical_unique_id=a.canonical_unique_id and b.lineage_key=s.lineage_key
    join pg_temp.live_lineage_v3082 m on m.unique_id=a.canonical_unique_id
    left join pg_temp.live_lineage_v3082 exact_live on exact_live.unique_id=a.source_unique_id
    left join pg_temp.staged_lineage_v3082 exact_source on exact_source.unique_id=a.canonical_unique_id
    where exact_live.unique_id is null and exact_source.unique_id is null
  )
  select candidates.row_number,candidates.canonical_unique_id from candidates where matches=1;
end
$alias$;

-- Extract the installed edge query so ranking, ambiguity and the raw import
-- path keep the same predicates. The compiled variant uses indexed UID
-- probes only where the query actually needs a wide live inventory row.
do $wire$
declare
  owner_def text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  edge_start text := '  create temp table ph_master_ordinal_edges on commit drop as';
  edge_end text := E'\n  );\n\n  create temp table ph_master_bulk_map_v1';
  old_alias text := '    select * from private.prior_drive_source_aliases_v3046();';
  edge_sql text;
  indexed_sql text;
begin
  if cardinality(string_to_array(owner_def,edge_start))<>2
    or cardinality(string_to_array(owner_def,edge_end))<>2
    or cardinality(string_to_array(owner_def,old_alias))<>2 then
    raise exception 'DRIVE_LINEAGE_OWNER_CHANGED';
  end if;
  edge_sql:=edge_start||split_part(split_part(owner_def,edge_start,2),edge_end,1)||E'\n  );';
  indexed_sql:=replace(edge_sql,'pg_temp.ph_master_bulk_stage_v1','pg_temp.staged_lineage_v3082');
  indexed_sql:=replace(indexed_sql,'from public.ph_master_inventory m where m.unique_id=s.unique_id',
    'from pg_temp.live_lineage_v3082 m where m.unique_id=s.unique_id');
  indexed_sql:=replace(indexed_sql,'select unique_id from public.ph_master_inventory',
    'select unique_id from pg_temp.live_lineage_v3082');
  indexed_sql:=replace(indexed_sql,'join public.ph_master_inventory m on m.unique_id=s.canonical_unique_id',
    'join lateral (select a.* from public.ph_master_inventory a where a.unique_id=s.canonical_unique_id offset 0) m on true');
  indexed_sql:=replace(indexed_sql,'join public.ph_master_inventory m on m.unique_id=c.canonical_unique_id',
    'join lateral (select a.* from public.ph_master_inventory a where a.unique_id=c.canonical_unique_id offset 0) m on true');
  if cardinality(string_to_array(indexed_sql,'offset 0) m on true'))<>3
    or cardinality(string_to_array(indexed_sql,'pg_temp.live_lineage_v3082'))<>3 then
    raise exception 'DRIVE_LINEAGE_QUERY_CHANGED';
  end if;
  execute 'create function private.build_drive_ordinal_edges_v3082(p_compiled boolean)
    returns void language plpgsql set search_path='''' as $edges$
    declare previous_nestloop text := current_setting(''enable_nestloop'');
    begin
      if p_compiled then
        perform set_config(''enable_nestloop'',''off'',true);
        '||indexed_sql||'
        perform set_config(''enable_nestloop'',previous_nestloop,true);
      else
        '||edge_sql||'
      end if;
    end $edges$';
  owner_def:=replace(owner_def,E'  create temp table ph_master_bulk_prior_alias_v3046 on commit drop as\n'||old_alias,
    $sql$  if private.has_drive_work_binding_v3078(true) then
    perform private.prepare_drive_lineage_work_v3082();
    create temp table ph_master_bulk_prior_alias_v3046 on commit drop as
      select * from private.compiled_drive_prior_aliases_v3082();
  else
    create temp table ph_master_bulk_prior_alias_v3046 on commit drop as
      select * from private.prior_drive_source_aliases_v3046();
  end if;$sql$);
  if strpos(owner_def,'private.prepare_drive_lineage_work_v3082()')=0 then
    raise exception 'DRIVE_LINEAGE_ALIAS_OWNER_CHANGED';
  end if;
  execute replace(owner_def,edge_sql,
    '  perform private.build_drive_ordinal_edges_v3082(private.has_drive_work_binding_v3078(true));');
end
$wire$;

-- Pull the current live stock and evidence by the indexed canonical UID.
-- Keep the order delta formula and the single publication transaction.
do $stock$
declare
  stock_def text := pg_get_functiondef('private.build_compiled_drive_order_delta_v3078()'::regprocedure);
  master_join text := 'from mapped_stock s join public.ph_master_inventory m on m.unique_id=s.canonical_unique_id';
begin
  if cardinality(string_to_array(stock_def,master_join))<>2 then
    raise exception 'DRIVE_ORDER_DELTA_OWNER_CHANGED';
  end if;
  execute replace(stock_def,master_join,$lookup$from mapped_stock s
    join lateral (
      select live.unique_id,live.erp_on_hand,live.erp_ptrreview,live.ptronhand,live.ptrreviewed,
        live.loc_photo_match,live.loc_match_qty,live.photo_date,live.av_rule_photo_updated_at,live.date_completed
      from public.ph_master_inventory live where live.unique_id=s.canonical_unique_id offset 0
    ) m on true$lookup$);
end
$stock$;

-- Evaluate season eligibility once per reconciliation statement, using that
-- statement's snapshot of pending overrides and app actions.
do $season$
declare
  definition text := pg_get_functiondef('private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure);
  old_join text := $join$join app_sync_private.inventory_season_stock_overrides_v1 season_stock
      on season_stock.itemcode=stage.itemcode and season_stock.pending and not exists(select 1 from public.app_row_actions a
      where a.changed_fields && array['s_lts','season_oh'] and a.app_update_row->>'itemcode'=season_stock.itemcode
      and private.inventory_stock_season_v1(a.app_update_row->>'lotcode',a.app_update_row->>'season')=season_stock.season)$join$;
begin
  if cardinality(string_to_array(definition,old_join))<>3 then
    raise exception 'DRIVE_SEASON_OVERRIDE_OWNER_CHANGED';
  end if;
  execute replace(definition,old_join,$snapshot$join (
      with eligible_season_stock as materialized (
        select stock.itemcode,stock.season,stock.open_stock,stock.season_oh,stock.updated_by
        from app_sync_private.inventory_season_stock_overrides_v1 stock
        where stock.pending and not exists (
          select 1 from public.app_row_actions a
          where a.changed_fields && array['s_lts','season_oh'] and a.app_update_row->>'itemcode'=stock.itemcode
            and private.inventory_stock_season_v1(a.app_update_row->>'lotcode',a.app_update_row->>'season')=stock.season
        )
      )
      select * from eligible_season_stock
    ) season_stock on season_stock.itemcode=stage.itemcode$snapshot$);
end
$season$;

-- Evaluate acknowledgement only for mapped rows with pending edits. Use the
-- existing matcher, including legacy priority/hold tuple semantics.
create function private.prepare_drive_pending_ack_v3084()
returns void language plpgsql set search_path='' as $ack$
begin
  create temp table pending_ack_uids_v3084 on commit drop as
    with pending as materialized (
      select canonical_unique_id from app_sync_private.inventory_live_overrides_v1 where pending
      union
      select canonical_unique_id from app_sync_private.ph_master_inventory_app_edits where pending_legacy_sync
    )
    select mapped.canonical_unique_id as unique_id
    from pending join pg_temp.ph_master_bulk_map_v1 mapped using(canonical_unique_id)
    join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
    where private.ph_master_bulk_pending_ack_v1(mapped.canonical_unique_id,s.raw_values);
  create unique index on pending_ack_uids_v3084(unique_id);
  analyze pg_temp.pending_ack_uids_v3084;

  create temp table drive_conflict_source_hash_v3084 on commit drop as
    with candidates as (
      select s.unique_id,s.source_hash,0 as precedence
      from pg_temp.ph_master_bulk_stage_v1 s
      union all
      select mapped.canonical_unique_id,s.source_hash,1
      from pg_temp.ph_master_bulk_map_v1 mapped
      join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
      where mapped.canonical_unique_id is not null
    )
    select distinct on (unique_id) unique_id,source_hash
    from candidates order by unique_id,precedence;
  create unique index on drive_conflict_source_hash_v3084(unique_id);
  analyze pg_temp.drive_conflict_source_hash_v3084;
end
$ack$;

-- Freeze the set of source row numbers before entering the master write.
-- Keep the original write predicates as rechecks for genuinely changed rows.
create function private.filter_drive_update_candidates_v3084(p_sql text)
returns text language plpgsql immutable set search_path='' as $candidates$
declare
  head constant text := 'with affected as (';
  input constant text := E'from pg_temp.ph_master_bulk_stage_v1 s\n         join pg_temp.ph_master_bulk_map_v1 mapped using (row_number)';
  result_anchor constant text := E'\n         returning target.unique_id';
  start_at integer := strpos(p_sql,input);
  end_at integer := strpos(p_sql,result_anchor);
  candidates text;
begin
  if not starts_with(p_sql,head||E'\n         update public.ph_master_inventory target set ') then return p_sql; end if;
  if start_at=0 or end_at<=start_at
    or cardinality(string_to_array(p_sql,input))<>2
    or cardinality(string_to_array(p_sql,result_anchor))<>2 then
    raise exception 'DRIVE_UPDATE_CANDIDATE_INPUT_CHANGED';
  end if;
  candidates := replace(substr(p_sql,start_at,end_at-start_at),input,input||E'\n'
    || '         join lateral (select a.* from public.ph_master_inventory a'
    || ' where a.unique_id=mapped.canonical_unique_id offset 0) target on true');
  return 'with changed_rows as materialized (select s.row_number '||candidates
    || E'\n       ), ' || replace(substr(p_sql,6),input,input
      || E'\n         join changed_rows changed using (row_number)');
end
$candidates$;

create function private.filter_drive_upsert_candidates_v3084(p_sql text)
returns text language plpgsql immutable set search_path='' as $candidates$
declare
  head constant text := E'with affected as (
         insert into public.ph_master_inventory';
  input constant text := ' from pg_temp.ph_master_bulk_stage_v1 s';
  conflict constant text := E'
         on conflict (unique_id) do update';
  start_at integer := strpos(p_sql,input);
  end_at integer := strpos(p_sql,conflict);
  candidate_sql text;
begin
  if not starts_with(p_sql,head) then return p_sql; end if;
  if start_at=0 or end_at<=start_at
    or cardinality(string_to_array(p_sql,input))<>2
    or cardinality(string_to_array(p_sql,conflict))<>2 then
    raise exception 'DRIVE_UPSERT_CANDIDATE_INPUT_CHANGED';
  end if;
  candidate_sql := replace(substr(p_sql,start_at,end_at-start_at),
    'left join public.ph_master_inventory existing on existing.unique_id=mapped.canonical_unique_id',
    'left join lateral (select a.* from public.ph_master_inventory a'
    || ' where a.unique_id=mapped.canonical_unique_id offset 0) existing on true');
  return 'with changed_rows as materialized (select s.row_number'||candidate_sql
    || E'
       ), affected as (' || substr(p_sql,length('with affected as (')+1,start_at-length('with affected as (')-1)
    || input || E'
         join pg_temp.ph_master_bulk_map_v1 mapped using (row_number)'
    || E'
         join changed_rows changed using (row_number)'
    || substr(p_sql,end_at);
end
$candidates$;

-- Keep the direct UPDATE delta and conflict guards. This transformation runs
-- only for the certified compiled source, after its canonical mapping exists.
do $upsert$
declare
  owner_def text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  cohort_def text := pg_get_functiondef('private.drive_compiled_cohort_sql_v3078(text,text,jsonb)'::regprocedure);
  context_call text := '  perform private.open_master_bulk_temp_context_v3046(p_run_id,p_request_id);';
  cohort_return text := ' return replace(p_sql,predicate,format(''s.erp_work_cohort = %s'',cohort));';
begin
  if cardinality(string_to_array(owner_def,context_call))<>2
    or cardinality(string_to_array(cohort_def,cohort_return))<>2 then
    raise exception 'DRIVE_UPSERT_OWNER_CHANGED';
  end if;
  owner_def := replace(owner_def,$lock$SET lock_timeout TO '4s'$lock$,$lock$SET lock_timeout TO '15s'$lock$);
  if strpos(owner_def,$lock$SET lock_timeout TO '15s'$lock$)=0 then
    raise exception 'DRIVE_PUBLICATION_TIMEOUT_OWNER_CHANGED';
  end if;
  execute replace(owner_def,context_call,context_call||E'\n  if private.has_drive_work_binding_v3078(true) then\n'
    ||E'    perform private.prepare_drive_pending_ack_v3084();\n  end if;');
  execute replace(cohort_def,cohort_return,$sql$
 p_sql:=replace(p_sql,
   'private.ph_master_bulk_pending_ack_v1(target.unique_id, s.raw_values)',
   'exists(select 1 from pg_temp.pending_ack_uids_v3084 ack where ack.unique_id=target.unique_id)');
 p_sql:=replace(p_sql,
   'private.ph_master_bulk_pending_ack_v1(mapped.canonical_unique_id, s.raw_values)',
   'exists(select 1 from pg_temp.pending_ack_uids_v3084 ack where ack.unique_id=mapped.canonical_unique_id)');
 p_sql:=regexp_replace(p_sql,
   'private[.]ph_master_bulk_pending_ack_v1[(]target[.]unique_id, [(]select c[.]raw_values from private[.]ph_master_bulk_context_v1[(]''[0-9a-f-]+''::uuid, target[.]unique_id[)] c[)][)]',
   'exists(select 1 from pg_temp.pending_ack_uids_v3084 ack where ack.unique_id=target.unique_id)');
 p_sql:=regexp_replace(p_sql,
   '[(]select c[.]source_hash from private[.]ph_master_bulk_context_v1[(]''[0-9a-f-]+''::uuid, target[.]unique_id[)] c[)]',
   'coalesce((select source.source_hash from pg_temp.drive_conflict_source_hash_v3084 source where source.unique_id=target.unique_id),\&)');
 if strpos(p_sql,'private.ph_master_bulk_pending_ack_v1(')>0 then
   raise exception 'DRIVE_UPSERT_ACK_PREDICATE_CHANGED';
 end if;
 p_sql:=replace(p_sql,predicate,format('s.erp_work_cohort = %s',cohort));
 return private.filter_drive_upsert_candidates_v3084(private.filter_drive_update_candidates_v3084(p_sql));$sql$);
end
$upsert$;

revoke all on function private.prepare_drive_lineage_work_v3082(),
  private.compiled_drive_prior_aliases_v3082(),private.build_drive_ordinal_edges_v3082(boolean),
  private.prepare_drive_pending_ack_v3084(),private.filter_drive_upsert_candidates_v3084(text),
  private.filter_drive_update_candidates_v3084(text)
from public,anon,authenticated,service_role;

-- Post-upsert DDL. The installed lineage prefix and this section can be
-- applied separately; neither operation publishes staged inventory.
create or replace function private.reconcile_drive_item6_location_notes_v3084(p_run_id uuid)
returns void language plpgsql set search_path='' set enable_nestloop=off as $notes$
begin
  create temp table drive_item6_note_delta_v3084 on commit drop as
    with staged_notes as materialized (
      select mapped.canonical_unique_id,s.raw_values->'locationnote' as raw_note
      from pg_temp.ph_master_bulk_map_v1 mapped
      join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
      where mapped.canonical_unique_id is not null and s.raw_item6_fields @> array['locationnote']
    )
    select n.canonical_unique_id,n.raw_note from staged_notes n
    join app_sync_private.ph_master_inventory_item6_source_v7 i using(canonical_unique_id)
    where i.field_values->'locationnote' is distinct from n.raw_note;
  create unique index on pg_temp.drive_item6_note_delta_v3084(canonical_unique_id);
  analyze pg_temp.drive_item6_note_delta_v3084;

  update app_sync_private.ph_master_inventory_item6_source_v7 i
  set field_values=jsonb_set(i.field_values,'{locationnote}',n.raw_note,true),
      imported_at=clock_timestamp(),import_run_id=p_run_id
  from pg_temp.drive_item6_note_delta_v3084 n
  where i.canonical_unique_id=n.canonical_unique_id
    and i.field_values->'locationnote' is distinct from n.raw_note;
end
$notes$;

do $notes_owner$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  opening constant text := E'    with notes as (\n      select distinct on (mapped.canonical_unique_id)';
  closing constant text := E'      and i.field_values->''locationnote'' is distinct from notes.raw_note;';
  start_at integer := strpos(definition,opening);
  end_at integer := strpos(definition,closing);
  original_sql text;
begin
  if strpos(definition,'private.reconcile_drive_item6_location_notes_v3084(p_run_id)')>0 then return; end if;
  if start_at=0 or end_at<=start_at or cardinality(string_to_array(definition,opening))<>2
    or cardinality(string_to_array(definition,closing))<>2 then
    raise exception 'DRIVE_ITEM6_NOTE_OWNER_CHANGED';
  end if;
  original_sql := substr(definition,start_at,end_at+length(closing)-start_at);
  execute overlay(definition placing E'    if private.has_drive_work_binding_v3078(true) then\n'
    ||E'      perform private.reconcile_drive_item6_location_notes_v3084(p_run_id);\n'
    ||E'    else\n'||original_sql||E'\n    end if;'
    from start_at for length(original_sql));
end
$notes_owner$;

revoke all on function private.reconcile_drive_item6_location_notes_v3084(uuid)
from public,anon,authenticated,service_role;

do $assignment$
declare
  definition text := pg_get_functiondef('private.apply_drive_row_assignment_plan_v3047(bigint)'::regprocedure);
  wide constant text := '    select p.*, (a.master_unique_id is not null and (a.itemcode,';
  stamp constant text := 'update public.ph_inventory_row_assignments a set unique_id=p.unique_id,policy_revision=p.policy_revision,';
  stamp_source constant text := '    from row_decisions p where p.stamp_only and a.master_unique_id=p.master_unique_id';
  write_source constant text := '   from row_decisions where not stamp_only order by master_unique_id on conflict';
begin
  if cardinality(string_to_array(definition,wide))<>2 or cardinality(string_to_array(definition,stamp))<>2
    or cardinality(string_to_array(definition,stamp_source))<>2 or cardinality(string_to_array(definition,write_source))<>2
    or not exists(select 1 from pg_constraint where conrelid='public.ph_inventory_row_assignments'::regclass
      and conname='ph_inventory_row_assignments_uid_alias' and convalidated
      and pg_get_constraintdef(oid)='CHECK ((unique_id = master_unique_id))') then
    raise exception 'DRIVE_ASSIGNMENT_NARROW_STAMP_OWNER_CHANGED';
  end if;
  definition:=replace(definition,wide,
    '    select p.master_unique_id as decision_uid, (a.master_unique_id is not null and (a.itemcode,');
  definition:=replace(definition,stamp,
    'update public.ph_inventory_row_assignments a set policy_revision=p.policy_revision,');
  definition:=replace(definition,stamp_source,
    '    from pg_temp.drive_row_assignments_v3047 p join row_decisions d on d.decision_uid=p.master_unique_id
    where d.stamp_only and a.master_unique_id=p.master_unique_id');
  definition:=replace(definition,write_source,
    '   from pg_temp.drive_row_assignments_v3047 p join row_decisions d on d.decision_uid=p.master_unique_id
    where not d.stamp_only order by p.master_unique_id on conflict');
  execute definition;
end
$assignment$;

-- The dedicated catch-up publisher opts in for one transaction. Keep normal
-- assignment reconciliation and all independent delivery sessions active.
do $catchup_outbox$
declare
  assignment_definition text := pg_get_functiondef('private.sync_new_unassigned_warehouse_itemcodes_v1(uuid)'::regprocedure);
  wake_definition text := pg_get_functiondef('private.wake_request_delivery_worker_now(text)'::regprocedure);
  assignment_anchor constant text := $anchor$from owner_values d where nullif(btrim(coalesce(d.assignedto,'')),'') is null$anchor$;
  wake_anchor constant text := '  select decrypted_secret into worker_url';
  guard constant text := $guard$current_setting('app.skip_catchup_outbox',true) is not distinct from 'on'
      and session_user = 'postgres' and coalesce(auth.role(),'') = 'service_role'$guard$;
begin
  if md5(assignment_definition)<>'9f79749fb2ef8aa219b70d3330e82845'
    or md5(wake_definition)<>'112362b33775fbcf5c49b4d050f2cb7b'
    or cardinality(string_to_array(assignment_definition,assignment_anchor))<>2
    or cardinality(string_to_array(wake_definition,wake_anchor))<>2 then
    raise exception 'DRIVE_CATCHUP_OUTBOX_OWNER_CHANGED';
  end if;
  execute replace(assignment_definition,assignment_anchor,assignment_anchor||E'\n      and not ('||guard||')');
  execute replace(wake_definition,wake_anchor,'  if '||guard||E' then return null; end if;\n'||wake_anchor);
end
$catchup_outbox$;
commit;

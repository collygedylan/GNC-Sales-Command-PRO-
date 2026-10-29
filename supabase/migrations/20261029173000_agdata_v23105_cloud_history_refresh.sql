begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- Reuse the existing immutable history manifest and stats publication. Only
-- items in changed file versions are reduced again after the baseline run.
create or replace function public.activate_eval_item_low_stock_import_v1(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='55s'
as $function$
declare
  current_state private.ph_eval_item_low_stock_import_state%rowtype;
  run_status text;
  expected_count integer;
  linked_count integer;
  pending_count integer;
  affected_codes text[];
begin
  select * into current_state from private.ph_eval_item_low_stock_import_state where singleton for update;
  select status into run_status from private.ph_eval_item_low_stock_import_runs where run_id=p_run_id for update;
  if run_status is null then raise exception using errcode='P0002',message='LOW_STOCK_IMPORT_RUN_NOT_FOUND'; end if;
  if run_status='active' and current_state.active_run_id=p_run_id then
    return jsonb_build_object('status','active','run_id',p_run_id);
  end if;
  if run_status<>'building' or current_state.pending_run_id is distinct from p_run_id then
    raise exception using errcode='55000',message='LOW_STOCK_IMPORT_RUN_SUPERSEDED';
  end if;
  select jsonb_array_length(expected_manifest) into expected_count
    from private.ph_eval_item_low_stock_import_runs where run_id=p_run_id;
  select count(*)::integer into linked_count
    from private.ph_eval_item_low_stock_run_files r
    join private.ph_eval_item_low_stock_file_versions v on v.file_version_id=r.file_version_id
    where r.run_id=p_run_id and v.status='finalized' and r.drive_file_id=v.drive_file_id and r.source_revision=v.source_revision;
  select count(*)::integer into pending_count
    from private.ph_eval_item_low_stock_run_files r
    left join private.ph_eval_item_low_stock_file_versions v on v.file_version_id=r.file_version_id
    where r.run_id=p_run_id and (r.file_version_id is null or v.status<>'finalized'
      or r.drive_file_id<>v.drive_file_id or r.source_revision<>v.source_revision);
  if linked_count<>expected_count or pending_count>0 then
    raise exception using errcode='55000',message='LOW_STOCK_IMPORT_COVERAGE_INCOMPLETE';
  end if;

  if current_state.active_run_id is not null then
    with changed_files as (
      select old_file.file_version_id
      from private.ph_eval_item_low_stock_run_files old_file
      where old_file.run_id=current_state.active_run_id and not exists(
        select 1 from private.ph_eval_item_low_stock_run_files new_file
        where new_file.run_id=p_run_id and new_file.drive_file_id=old_file.drive_file_id
          and new_file.source_revision=old_file.source_revision)
      union
      select new_file.file_version_id
      from private.ph_eval_item_low_stock_run_files new_file
      where new_file.run_id=p_run_id and not exists(
        select 1 from private.ph_eval_item_low_stock_run_files old_file
        where old_file.run_id=current_state.active_run_id and old_file.drive_file_id=new_file.drive_file_id
          and old_file.source_revision=new_file.source_revision)
    )
    select coalesce(array_agg(distinct row.itemcode_normalized order by row.itemcode_normalized),array[]::text[])
      into affected_codes
    from changed_files file
    join private.ph_eval_item_low_stock_order_rows row on row.file_version_id=file.file_version_id;
  end if;

  delete from private.ph_eval_item_low_stock_target_stats where run_id=p_run_id;
  if current_state.active_run_id is not null then
    insert into private.ph_eval_item_low_stock_target_stats(
      run_id,itemcode_normalized,qualifying_line_count,qualifying_day_count,source_file_count,mean_quantity,
      p75_quantity,suggested_qty,history_from_date,history_through_date,calculated_at)
    select p_run_id,itemcode_normalized,qualifying_line_count,qualifying_day_count,source_file_count,mean_quantity,
      p75_quantity,suggested_qty,history_from_date,history_through_date,calculated_at
    from private.ph_eval_item_low_stock_target_stats
    where run_id=current_state.active_run_id and not (itemcode_normalized=any(coalesce(affected_codes,array[]::text[])));
  end if;

  insert into private.ph_eval_item_low_stock_target_stats(
    run_id,itemcode_normalized,qualifying_line_count,qualifying_day_count,source_file_count,mean_quantity,
    p75_quantity,suggested_qty,history_from_date,history_through_date,calculated_at)
  with active_rows as materialized (
    select v.file_version_id,v.drive_file_id,v.source_report_date,v.snapshot_at,v.source_created_at,
      row.group_key,row.itemcode_normalized,row.quantity_ordered
    from private.ph_eval_item_low_stock_run_files rf
    join private.ph_eval_item_low_stock_file_versions v on v.file_version_id=rf.file_version_id
    join private.ph_eval_item_low_stock_order_rows row on row.file_version_id=v.file_version_id
    where rf.run_id=p_run_id and v.status='finalized' and v.disposition='eligible'
      and (current_state.active_run_id is null or affected_codes is null or row.itemcode_normalized=any(affected_codes))
  ), group_files as (
    select distinct source_report_date,group_key,file_version_id,drive_file_id,snapshot_at,source_created_at from active_rows
  ), ranked_groups as (
    select source_report_date,group_key,file_version_id,snapshot_at,source_created_at,drive_file_id,
      row_number() over(partition by source_report_date,group_key
        order by snapshot_at desc,source_created_at desc nulls last,drive_file_id collate "C" desc,file_version_id desc) file_rank
    from group_files
  ), selected_daily_bags as (
    select rows.* from active_rows rows join ranked_groups ranked
      using(source_report_date,group_key,file_version_id) where ranked.file_rank=1
  )
  select p_run_id,itemcode_normalized,count(*)::integer,count(distinct source_report_date)::integer,
    count(distinct file_version_id)::integer,avg(quantity_ordered)::numeric,
    percentile_disc(0.75) within group(order by quantity_ordered)::numeric,
    ceil(avg(quantity_ordered)+greatest(avg(quantity_ordered),percentile_disc(0.75) within group(order by quantity_ordered)))::integer,
    min(source_report_date),max(source_report_date),clock_timestamp()
  from selected_daily_bags group by itemcode_normalized;

  update private.ph_eval_item_low_stock_import_runs set status='superseded'
    where run_id=current_state.active_run_id and status='active';
  update private.ph_eval_item_low_stock_import_runs set status='active',activated_at=clock_timestamp() where run_id=p_run_id;
  update private.ph_eval_item_low_stock_import_state set active_run_id=p_run_id,pending_run_id=null,updated_at=clock_timestamp()
    where singleton;
  return jsonb_build_object('status','active','run_id',p_run_id,'incremental',current_state.active_run_id is not null,
    'affected_itemcodes',coalesce(cardinality(affected_codes),0));
end
$function$;

revoke all on function public.activate_eval_item_low_stock_import_v1(uuid) from public,anon,authenticated;
grant execute on function public.activate_eval_item_low_stock_import_v1(uuid) to service_role;

-- Historical state compaction/dedup no longer has a time-of-day pause. These
-- bounded operations remain callable only through their pre-existing grants.
do $remove_history_window$
declare
  compact_definition text;
  drive_definition text;
  compact_gate text := E'  if not (chicago_time>=time ''23:30'' or chicago_time<time ''06:15'') then\n    return jsonb_build_object(''status'',''paused_outside_historical_window'',''chicagoTime'',chicago_time);\n  end if;\n';
  drive_gate text := E'  if not (chicago_time>=time ''23:30'' or chicago_time<time ''06:15'') then\n    return jsonb_build_object(''status'',''paused_outside_historical_window'',''processedFiles'',0,''durationMs'',0);\n  end if;\n';
begin
  compact_definition:=pg_get_functiondef('private.compact_history_states_v2366()'::regprocedure);
  drive_definition:=pg_get_functiondef('public.deduplicate_drive_around_report_rows_batch_v1(integer)'::regprocedure);
  if position('paused_outside_historical_window' in compact_definition)>0 then
    execute replace(compact_definition,compact_gate,'');
  end if;
  if position('paused_outside_historical_window' in drive_definition)>0 then
    execute replace(drive_definition,drive_gate,'');
  end if;
  if position('paused_outside_historical_window' in pg_get_functiondef('private.compact_history_states_v2366()'::regprocedure))>0
     or position('paused_outside_historical_window' in pg_get_functiondef('public.deduplicate_drive_around_report_rows_batch_v1(integer)'::regprocedure))>0 then
    raise exception using errcode='55000',message='HISTORY_WINDOW_GUARD_REMAINS';
  end if;
end
$remove_history_window$;
commit;

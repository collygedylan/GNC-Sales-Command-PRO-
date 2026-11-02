begin;
set local lock_timeout='60s';
set local statement_timeout='180s';
-- Preserve the established bulk trigger bypass without ALTER TABLE locks.
-- Only the canonical service-role publisher sets these transaction-local flags.
do $migration$
declare fn record; source text; changed text; guard text;
begin
  guard := E'begin\n  if tg_table_schema=''public'' and tg_table_name in (''ph_master_inventory'',''ph_drive_around_report_rows'')\n     and coalesce(auth.role(),'''')=''service_role''\n     and current_setting(''agdata.bulk_import.''||tg_table_name,true)=''on'' then\n    if tg_op=''DELETE'' then return old; end if;\n    return new;\n  end if;';
  for fn in select distinct p.oid,p.prolang from pg_proc p join pg_trigger t on t.tgfoid=p.oid
    where t.tgrelid in ('public.ph_master_inventory'::regclass,'public.ph_drive_around_report_rows'::regclass) and not t.tgisinternal
  loop
    if fn.prolang <> (select oid from pg_language where lanname='plpgsql') then raise exception 'ERP_TRIGGER_LANGUAGE_UNREVIEWED'; end if;
    source:=pg_get_functiondef(fn.oid);
    if position('agdata.bulk_import.' in source)=0 then
      changed:=regexp_replace(source,'\mbegin\M',guard,'i');
      if changed=source then raise exception 'ERP_TRIGGER_GUARD_MISSING'; end if;
      execute changed;
    end if;
  end loop;
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('fast_ingest_drive_around_v1','bulk_import_master_snapshot_v1')
  loop
    source:=pg_get_functiondef(fn.oid);
    changed:=replace(replace(source,
      'execute ''alter table public.ph_master_inventory disable trigger user'';',
      'perform set_config(''agdata.bulk_import.ph_master_inventory'',''on'',true);'),
      'execute ''alter table public.ph_master_inventory enable trigger user'';',
      'perform set_config(''agdata.bulk_import.ph_master_inventory'',''off'',true);');
    changed:=replace(replace(changed,
      'execute ''alter table public.ph_drive_around_report_rows disable trigger user'';',
      'perform set_config(''agdata.bulk_import.ph_drive_around_report_rows'',''on'',true);'),
      'execute ''alter table public.ph_drive_around_report_rows enable trigger user'';',
      'perform set_config(''agdata.bulk_import.ph_drive_around_report_rows'',''off'',true);');
    if changed ~* 'alter table.*(disable|enable) trigger' then raise exception 'ERP_PUBLISH_DDL_REMAINS'; end if;
    execute changed;
  end loop;
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and (p.proname like 'fast_ingest_%' or p.proname like 'bulk_import_master_snapshot_%'
      or p.proname in ('fast_commit_erp_stage_swap_v1','fast_seal_erp_stage_v1')))
      or (n.nspname='private' and p.proname in ('fast_finish_live_ingest_v2369','fast_ingest_snapshot_v2369'))
  loop
    execute format('alter function %s set lock_timeout = %L',fn.signature,'60s');
    execute format('alter function %s set statement_timeout = %L',fn.signature,'180s');
  end loop;
end $migration$;
-- One immutable delivery event for the sorted unassigned set, never one per row.
do $migration$
declare source text; original text; replacement text;
begin
  source:=pg_get_functiondef('private.sync_new_unassigned_warehouse_itemcodes_v1(uuid)'::regprocedure);
  original:=$old$select 'eval-unassigned:'||md5(d.code),'eval_assignment_unassigned',
      jsonb_build_object('itemcode',d.code,
        'manager_usernames',jsonb_build_array('dylan_collyge','megan_kelly')),'pending'
    from owner_values d where nullif(btrim(coalesce(d.assignedto,'')),'') is null$old$;
  replacement:=$new$select 'eval-unassigned-summary:'||md5(string_agg(distinct d.code,',' order by d.code)),'eval_assignment_summary',
      jsonb_build_object('unassignedCount',count(distinct d.code),'unassignedItemcodes',jsonb_agg(distinct d.code order by d.code),
        'manager_usernames',jsonb_build_array('dylan_collyge','megan_kelly')),'pending'
    from owner_values d where nullif(btrim(coalesce(d.assignedto,'')),'') is null
    having count(distinct d.code)>0$new$;
  if position(original in source)=0 then raise exception 'ERP_SUMMARY_SOURCE_MISMATCH'; end if;
  execute replace(source,original,replacement);
end $migration$;
commit;

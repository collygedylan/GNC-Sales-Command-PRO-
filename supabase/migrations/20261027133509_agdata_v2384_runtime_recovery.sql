begin;
set local lock_timeout='1500ms';
set local statement_timeout='10s';

alter table public.app_runtime_watchdog_events
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_in_version text;

do $repair_bulk_master_alias_mapping$
declare
  definition text:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  anchor text:=$anchor$  update pg_temp.ph_master_bulk_map_v1 mapped
  set canonical_unique_id = mapped.source_unique_id
  where mapped.canonical_unique_id is null;

  if exists ($anchor$;
  replacement text:=$replacement$  update pg_temp.ph_master_bulk_map_v1 mapped
  set canonical_unique_id = mapped.source_unique_id
  where mapped.canonical_unique_id is null;

  -- An alias can point at a canonical row deleted by a later complete snapshot.
  -- When this import inserted the source identity, publish that exact row rather
  -- than rejecting the otherwise complete atomic swap as a concurrent change.
  update pg_temp.ph_master_bulk_map_v1 mapped
  set canonical_unique_id = mapped.source_unique_id
  where not exists(
      select 1 from public.ph_master_inventory live
      where live.unique_id=mapped.canonical_unique_id
    )
    and exists(
      select 1 from public.ph_master_inventory live
      where live.unique_id=mapped.source_unique_id
    );

  if exists ($replacement$;
begin
  if position(replacement in definition)>0 then return; end if;
  if position(anchor in definition)=0
     or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'V2384_BULK_MASTER_ALIAS_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,anchor,replacement);
end
$repair_bulk_master_alias_mapping$;

update public.app_runtime_watchdog_events
set status='resolved',resolved_at=clock_timestamp(),resolved_in_version='2.3.84'
where status='open'
  and cluster_id in ('Cluster 3','Cluster 4','Cluster 5')
  and (
    (view_id='drive' and event_type='APP_API_FAILURE')
    or view_id='request'
    or (view_id='managers' and sub_module='assigned-items-export')
  );

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('release','AgData v2.3.84','app_version','2.3.84'),
  'release-v2.3.84',clock_timestamp())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

commit;

begin;
set local lock_timeout='1500ms';
set local statement_timeout='10s';

-- v2.3.88: stale DriveAround/split UIDs fall forward to the current physical
-- item/location row while keeping exact UID and exact lot matches highest.
do $migration$
declare
  target regprocedure := 'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_text text := $old$-- reclass-destination-row-loop-v2379: prefer source UID, then the exact normalized item/location/lot tuple.
  join lateral (
    select candidate.* from public.ph_master_inventory candidate
    where candidate.unique_id=btrim(coalesce(e.value#>>'{source,uniqueId}',''))
      or (upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,itemcode}','')))
        and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,locationcode}','')))
        and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,lotcode}',''))))
    order by (candidate.unique_id=btrim(coalesce(e.value#>>'{source,uniqueId}',''))) desc,candidate.unique_id
    limit 1
  ) m on true$old$;
  new_text text := $new$-- reclass-source-alias-v2388: prefer UID, exact lot, then the deterministic current split row.
  join lateral (
    select candidate.* from public.ph_master_inventory candidate
    where candidate.unique_id=btrim(coalesce(e.value#>>'{source,uniqueId}',''))
      or (upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,itemcode}','')))
        and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,locationcode}',''))))
    order by
      (candidate.unique_id=btrim(coalesce(e.value#>>'{source,uniqueId}',''))) desc,
      (upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,lotcode}','')))) desc,
      (upper(btrim(coalesce(candidate.season,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,season}','')))) desc,
      (upper(btrim(coalesce(candidate.contsize,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,contsize}','')))) desc,
      candidate.unique_id
    limit 1
  ) m on true$new$;
begin
  if position('reclass-source-alias-v2388' in definition)>0 then return; end if;
  if position(old_text in definition)=0
     or (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
    raise exception 'AGDATA_V2388_RECLASS_SOURCE_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,old_text,new_text);
end
$migration$;

update public.app_runtime_watchdog_events
set status='resolved',resolved_at=clock_timestamp(),resolved_in_version='2.3.88'
where status='open';

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('release','AgData v2.3.88','app_version','2.3.88'),
  'release-v2.3.88',clock_timestamp())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

do $installed$
begin
  if position('reclass-source-alias-v2388' in pg_get_functiondef(
      'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))=0 then
    raise exception 'AGDATA_V2388_RECLASS_SOURCE_NOT_INSTALLED';
  end if;
  if exists(select 1 from public.app_runtime_watchdog_events where status='open') then
    raise exception 'AGDATA_V2388_WATCHDOG_ROWS_STILL_OPEN';
  end if;
  if not exists(select 1 from public.ph_app_settings where key='app_version'
      and value->>'app_version'='2.3.88') then
    raise exception 'AGDATA_V2388_APP_VERSION_NOT_INSTALLED';
  end if;
end
$installed$;

commit;

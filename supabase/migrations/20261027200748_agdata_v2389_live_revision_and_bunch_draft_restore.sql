begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

insert into app_sync_private.sources(key,modules,client_enabled,dylan_only)
values('hl_po_parsed','{home,po}',true,false)
on conflict(key) do nothing;

create or replace function app_sync_private.touch_hl_po_parsed_v2389()
returns trigger language plpgsql security definer set search_path='' as $function$
declare latest hl_order_private.po_imports;
begin
  select * into latest from hl_order_private.po_imports
  where status in ('pending','reconciled','duplicate') and completed_at is not null
  order by completed_at desc,id desc limit 1;
  insert into public.app_dataset_revisions as revision_row(
    key,revision,state,changed_at,source_file_id,source_file_name,source_imported_at,source_import_run_id)
  values('hl_po_parsed',greatest(1,new.revision),'ready',clock_timestamp(),
    latest.metadata->>'source_file_id',latest.metadata->>'source_file_name',latest.completed_at,
    case when latest.run_id~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then latest.run_id::uuid else null end)
  on conflict(key) do update set revision=greatest(revision_row.revision+1,excluded.revision),
    state='ready',changed_at=excluded.changed_at,source_file_id=excluded.source_file_id,
    source_file_name=excluded.source_file_name,source_imported_at=excluded.source_imported_at,
    source_import_run_id=excluded.source_import_run_id;
  return new;
end
$function$;

drop trigger if exists hl_po_parsed_revision_v2389 on hl_order_private.state;
create trigger hl_po_parsed_revision_v2389 after update of revision on hl_order_private.state
for each row when (new.revision is distinct from old.revision)
execute function app_sync_private.touch_hl_po_parsed_v2389();

insert into public.app_dataset_revisions(key,revision,state,changed_at)
select 'hl_po_parsed',greatest(1,revision),'ready',clock_timestamp() from hl_order_private.state where singleton
on conflict(key) do nothing;

-- Legacy drafts may have used the display key F.05. Canonicalize only that
-- exact Dylan-owned legacy entry; the existing F.05.000 batch remains byte-for-byte.
update bunch_note_private.batches b
set body=jsonb_set(b.body,'{locations}',(
  select jsonb_agg(case
    when upper(coalesce(location->>'location',location->>'source_location',''))='F.05'
      then location||jsonb_build_object('location','F.05.000','source_location','F.05.000')
    else location end order by ordinal)
  from jsonb_array_elements(coalesce(b.body->'locations','[]'::jsonb)) with ordinality as entries(location,ordinal)
),false)
from public.profiles p
where p.id=b.created_by and lower(p.username)='dylan_collyge'
  and exists(select 1 from jsonb_array_elements(coalesce(b.body->'locations','[]'::jsonb)) location
    where upper(coalesce(location->>'location',location->>'source_location',''))='F.05');

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('release','AgData v2.3.89','app_version','2.3.89'),
  'release-v2.3.89',clock_timestamp())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

commit;

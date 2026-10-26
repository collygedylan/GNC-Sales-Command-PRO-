begin;

do $rename_fast_imports$
begin
  if to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)') is null then
    alter function public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)
      rename to bulk_import_master_snapshot_v2374_base;
  end if;
  if to_regprocedure('public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)') is null then
    alter function public.fast_ingest_drive_around_v1(jsonb,jsonb)
      rename to fast_ingest_drive_around_v2374_base;
  end if;
  if to_regprocedure('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)') is null then
    alter function public.finalize_master_snapshot_stage_v1(uuid,uuid,text)
      rename to finalize_master_snapshot_stage_v2374_base;
  end if;
end
$rename_fast_imports$;

do $raise_finalizer_internal_budget$
declare definition text; repaired text;
begin
  definition:=pg_get_functiondef('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure);
  repaired:=replace(replace(definition,
    'set_config(''statement_timeout'',''120s'',true)',
    'set_config(''statement_timeout'',''330s'',true)'),
    'SET statement_timeout TO ''120s''','SET statement_timeout TO ''330s''');
  if repaired=definition then raise exception 'FINALIZER_TIMEOUT_PATCH_ANCHOR_MISSING'; end if;
  execute repaired;
end
$raise_finalizer_internal_budget$;

create or replace function public.bulk_import_master_snapshot_v1(
  p_run_id uuid,p_request_id uuid,p_rows jsonb,p_source_digest text
)
returns jsonb
language plpgsql security definer set search_path=''
set statement_timeout='330s' set lock_timeout='5s'
as $function$
declare result_value jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='BULK_MASTER_IMPORT_FORBIDDEN';
  end if;
  execute 'alter table public.ph_master_inventory disable trigger user';
  begin
    result_value:=public.bulk_import_master_snapshot_v2374_base(p_run_id,p_request_id,p_rows,p_source_digest);
    update public.ph_master_inventory
    set av_note=public.sanitize_av_note_without_spec_caliper(av_note)
    where av_note is distinct from public.sanitize_av_note_without_spec_caliper(av_note);
  exception when others then
    execute 'alter table public.ph_master_inventory enable trigger user';
    raise;
  end;
  execute 'alter table public.ph_master_inventory enable trigger user';
  return result_value;
end
$function$;

create or replace function public.fast_ingest_drive_around_v1(p_file_meta jsonb,p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path=''
set statement_timeout='120s' set lock_timeout='5s'
as $function$
declare result_value jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='FAST_ERP_INGEST_FORBIDDEN';
  end if;
  execute 'alter table public.ph_drive_around_report_rows disable trigger user';
  begin
    result_value:=public.fast_ingest_drive_around_v2374_base(p_file_meta,p_rows);
  exception when others then
    execute 'alter table public.ph_drive_around_report_rows enable trigger user';
    raise;
  end;
  execute 'alter table public.ph_drive_around_report_rows enable trigger user';
  return result_value;
end
$function$;

create or replace function public.finalize_master_snapshot_stage_v1(
  p_run_id uuid,p_request_id uuid,p_source_digest text
)
returns jsonb
language plpgsql security definer set search_path=''
set statement_timeout='330s' set lock_timeout='5s'
as $function$
declare result_value jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='MASTER_SNAPSHOT_STAGE_FORBIDDEN';
  end if;
  execute 'alter table public.ph_master_inventory disable trigger user';
  begin
    result_value:=public.finalize_master_snapshot_stage_v2374_base(p_run_id,p_request_id,p_source_digest);
  exception when others then
    execute 'alter table public.ph_master_inventory enable trigger user';
    raise;
  end;
  execute 'alter table public.ph_master_inventory enable trigger user';
  return result_value;
end
$function$;

revoke all on function public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.fast_ingest_drive_around_v1(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.finalize_master_snapshot_stage_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.fast_ingest_drive_around_v1(jsonb,jsonb) to service_role;
grant execute on function public.finalize_master_snapshot_stage_v1(uuid,uuid,text) to service_role;
alter function public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text) set statement_timeout='330s';

do $remove_reclass_revision_guard$
declare definition text; repaired text;
begin
  definition:=pg_get_functiondef('public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)'::regprocedure);
  repaired:=replace(definition,
    'p_expected_revision is null or p_expected_revision < 1',
    'p_expected_revision is null or p_expected_revision < 0');
  repaired:=replace(repaired,
    'if current_revision is distinct from p_expected_revision then raise exception using errcode=''PT409'',message=''INVENTORY_RECLASS_REVISION_CONFLICT''; end if;',
    'perform current_revision;');
  if repaired=definition or repaired like '%INVENTORY_RECLASS_REVISION_CONFLICT%' then
    raise exception 'RECLASS_REVISION_GUARD_REPAIR_FAILED';
  end if;
  execute repaired;
end
$remove_reclass_revision_guard$;

create or replace function private.sync_request_actor_fields_v2370()
returns trigger language plpgsql set search_path=''
as $function$
declare submitter text; selected_rep text;
begin
  submitter:=coalesce(nullif(btrim(new.submitted_by),''),nullif(btrim(new.request_created_by_username),''),nullif(btrim(new.requested_by),''));
  selected_rep:=coalesce(nullif(btrim(new.request_selected_rep_display),''),nullif(btrim(new.sales_rep),''),nullif(btrim(new.request_selected_rep_username),''));
  new.submitted_by:=submitter;
  new.requested_by:=coalesce(selected_rep,new.requested_by);
  new.sales_rep:=selected_rep;
  return new;
end
$function$;

update public.ph_requests_pending
set submitted_by=coalesce(nullif(request_created_by_username,''),nullif(submitted_by,''),nullif(requested_by,'')),
    requested_by=coalesce(nullif(request_selected_rep_display,''),nullif(sales_rep,''),nullif(request_selected_rep_username,''),requested_by),
    sales_rep=coalesce(nullif(request_selected_rep_display,''),nullif(sales_rep,''),nullif(request_selected_rep_username,''));
update public.ph_requests_completed_history
set submitted_by=coalesce(nullif(request_created_by_username,''),nullif(submitted_by,''),nullif(requested_by,'')),
    requested_by=coalesce(nullif(request_selected_rep_display,''),nullif(sales_rep,''),nullif(request_selected_rep_username,''),requested_by),
    sales_rep=coalesce(nullif(request_selected_rep_display,''),nullif(sales_rep,''),nullif(request_selected_rep_username,''));

update public.ph_requests_completed_history
set sales_rep='Annette Hancock',requested_by='Annette Hancock',submitted_by='nelly_aguilar',
    request_selected_rep_display='Annette Hancock',request_selected_rep_username='annette_hancock',
    request_selected_rep_email='annette_hancock@greenleafnursery.com',
    request_created_by_username='nelly_aguilar',request_created_by_email='nelly_aguilar@greenleafnursery.com',
    recipient_emails=(select jsonb_agg(distinct email) from jsonb_array_elements_text(
      coalesce(recipient_emails,'[]'::jsonb)||jsonb_build_array('annette_hancock@greenleafnursery.com','nelly_aguilar@greenleafnursery.com')) email)
where itemcode='001777.030.1' and lower(coalesce(customername,customer_name,req_customer,'')) like '%allen landscape%';

update public.ph_request_email_threads thread
set sales_rep_name='Annette Hancock',sales_rep_email='annette_hancock@greenleafnursery.com',
    recipients=(select jsonb_agg(distinct email) from jsonb_array_elements_text(
      coalesce(thread.recipients,'[]'::jsonb)||jsonb_build_array('annette_hancock@greenleafnursery.com','nelly_aguilar@greenleafnursery.com')) email),
    metadata=coalesce(thread.metadata,'{}'::jsonb)||jsonb_build_object('submitted_by','nelly_aguilar')
where exists(select 1 from public.ph_requests_completed_history history
  where history.request_folder=thread.request_folder and history.itemcode='001777.030.1'
    and lower(coalesce(history.customername,history.customer_name,history.req_customer,'')) like '%allen landscape%');

update public.app_manual_sync_status
set status=coalesce(status,'{}'::jsonb)||jsonb_build_object(
  'state','idle','active',false,'currentStage','idle','currentStageLabel','',
  'error','','errorCode',null,'message','Ready','stageFailureCount',0
),updated_at=now();

update public.ph_master_inventory set av_note=public.sanitize_av_note_without_spec_caliper(av_note)
where av_note is distinct from public.sanitize_av_note_without_spec_caliper(av_note);
update public.ph_requests_pending set av_note=public.sanitize_av_note_without_spec_caliper(av_note)
where av_note is distinct from public.sanitize_av_note_without_spec_caliper(av_note);
update public.ph_requests_completed_history set av_note=public.sanitize_av_note_without_spec_caliper(av_note)
where av_note is distinct from public.sanitize_av_note_without_spec_caliper(av_note);
update public.ph_av_notes set salesnote=public.sanitize_av_note_without_spec_caliper(salesnote)
where salesnote is distinct from public.sanitize_av_note_without_spec_caliper(salesnote);

create or replace view public.ph_active_suspend with (security_invoker=true) as
select soc.*,
  coalesce(metric.on_hand,0) as on_hand,
  coalesce(metric.review,0) as review,
  coalesce(metric.available,0) as available,
  coalesce(stock.open_stock,0) as open_stock,
  coalesce(metric.loc_photo_match,0) as loc_photo_match,
  coalesce(location.loc_on_hand,0) as loc_on_hand
from public.ph_soc_master soc
left join lateral (
  select private.request_numeric_v2362(to_jsonb(master)->>'ptronhand') on_hand,
    private.request_numeric_v2362(to_jsonb(master)->>'ptrreviewed') review,
    private.request_numeric_v2362(to_jsonb(master)->>'ptravailable') available,
    private.request_numeric_v2362(to_jsonb(master)->>'loc_photo_match') loc_photo_match
  from public.ph_master_inventory master
  where upper(btrim(master.itemcode))=upper(btrim(soc.itemcode))
  order by ((upper(btrim(master.locationcode))=upper(btrim(soc.locationcode)))::int
    +(upper(btrim(master.lotcode))=upper(btrim(soc.lotcode)))::int) desc,master.unique_id
  limit 1
) metric on true
left join lateral (
  select sum(coalesce(private.request_numeric_v2362(master.ptravailable),0)) open_stock
  from public.ph_master_inventory master
  where upper(btrim(master.itemcode))=upper(btrim(soc.itemcode))
    and upper(btrim(master.lotcode)) ~ '\.(F1|S1)$'
) stock on true
left join lateral (
  select sum(coalesce(private.request_numeric_v2362(master.ptronhand),0)) loc_on_hand
  from public.ph_master_inventory master
  where upper(btrim(master.itemcode))=upper(btrim(soc.itemcode))
    and upper(btrim(master.locationcode))=upper(btrim(soc.locationcode))
) location on true;

create or replace view public.ph_soc_suspend_tag_rows with (security_invoker=true) as
select * from public.ph_active_suspend
where upper(btrim(coalesce(suspend,'')))='SUSPEND' and lower(btrim(coalesce(suspend_to,'')))='dc';
grant select on public.ph_active_suspend,public.ph_soc_suspend_tag_rows to anon,authenticated;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('app_version','2.3.74','release','AgData v2.3.74'),'release-v2.3.74',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

do $v2374_contract$
declare definition text;
begin
  definition:=pg_get_functiondef('public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)'::regprocedure);
  if definition like '%INVENTORY_RECLASS_REVISION_CONFLICT%' then raise exception 'RECLASS_REVISION_GUARD_REMAINS'; end if;
  if not exists(select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='public' and relation.relname='ph_active_suspend'
      and coalesce(relation.reloptions,'{}'::text[]) @> array['security_invoker=true']) then
    raise exception 'SUSPEND_SECURITY_INVOKER_MISSING';
  end if;
  if has_function_privilege('anon','public.fast_ingest_drive_around_v1(jsonb,jsonb)','EXECUTE') then
    raise exception 'ANON_FAST_INGEST_EXPOSED';
  end if;
end
$v2374_contract$;

commit;

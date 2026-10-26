begin;

create temp table v2368_photo_date_protected_counts on commit drop as
select
  (select count(*) from public.ph_requests_pending) request_rows,
  (select count(*) from public.ph_active_suspend) suspend_rows,
  (select count(*) from public.ph_active_recount) recount_rows,
  (select count(*) from public.ph_active_bunch_notes) bunch_note_rows;

do $patch_master_photo_date$
declare
  source text;
  needle text:=E'    new.photo_date:=null;';
  replacement text:=E'    new.photo_date:=case\n      when nullif(btrim(concat_ws('','',new.photo_link,new.dock_photo_link,new.flyer_photo_link)),'''') is not null\n      then coalesce(canonical_photo_date,new.date_completed,new.last_updated)\n      else null\n    end;';
begin
  source:=pg_get_functiondef('private.sync_master_inventory_canonical_v2362()'::regprocedure);
  if position(needle in source)=0 or length(source)-length(replace(source,needle,''))<>length(needle) then
    raise exception 'V2368_MASTER_PHOTO_DATE_PATCH_POINT_INVALID';
  end if;
  execute replace(source,needle,replacement);
end
$patch_master_photo_date$;

update public.ph_master_inventory row
set photo_date=coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    coalesce(row.av_rule_photo_updated_at,row.date_completed,row.last_updated)::text),
  row.date_completed,row.last_updated)
where row.photo_date is null
  and nullif(btrim(concat_ws(',',row.photo_link,row.dock_photo_link,row.flyer_photo_link)),'') is not null;

do $assert_master_photo_date$
declare
  protected v2368_photo_date_protected_counts%rowtype;
begin
  select * into protected from v2368_photo_date_protected_counts;
  if protected.request_rows<>(select count(*) from public.ph_requests_pending)
    or protected.suspend_rows<>(select count(*) from public.ph_active_suspend)
    or protected.recount_rows<>(select count(*) from public.ph_active_recount)
    or protected.bunch_note_rows<>(select count(*) from public.ph_active_bunch_notes) then
    raise exception 'V2368_MASTER_PHOTO_DATE_QUEUE_COUNT_CHANGED';
  end if;
  if exists(select 1 from public.ph_master_inventory row
    where row.photo_date is null
      and nullif(btrim(concat_ws(',',row.photo_link,row.dock_photo_link,row.flyer_photo_link)),'') is not null) then
    raise exception 'V2368_MASTER_PHOTO_DATE_BACKFILL_INCOMPLETE';
  end if;
  if position('concat_ws(' in pg_get_functiondef(
      'private.sync_master_inventory_canonical_v2362()'::regprocedure))=0 then
    raise exception 'V2368_MASTER_PHOTO_DATE_TRIGGER_CONTRACT_MISSING';
  end if;
end
$assert_master_photo_date$;

commit;

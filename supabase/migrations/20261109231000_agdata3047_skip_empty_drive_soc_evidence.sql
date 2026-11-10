begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Stock/provenance updates still fire the Drive statement trigger. Check the
-- exact transition evidence before planning any SOC write and constrain real
-- publication to the changed, narrow source rows.
create or replace function private.publish_drive_evidence_to_soc_v23142()
returns trigger language plpgsql security definer set search_path='' as $publish$
begin
  if current_setting('app.eval_publication_v309',true)='on' then return null; end if;
  if not exists(select 1 from new_drive_evidence n join old_drive_evidence o using(unique_id)
    where (n.photo_link,n.spec,n.caliper,n.av_note,n.pick_note,n.match,n.loc_match_qty,n.date_completed)
      is distinct from (o.photo_link,o.spec,o.caliper,o.av_note,o.pick_note,o.match,o.loc_match_qty,o.date_completed)
  ) then return null; end if;

  with changed_drive_evidence as materialized (
    select n.unique_id,n.itemcode,n.locationcode,n.lotcode,n.priority,n.photo_link,n.photo_name,n.photo_url,n.photos,
      n.spec,n.caliper,n.av_note,n.pick_note,n.match,n.loc_match_qty,n.date_completed
    from new_drive_evidence n join old_drive_evidence o using(unique_id)
    where (n.photo_link,n.spec,n.caliper,n.av_note,n.pick_note,n.match,n.loc_match_qty,n.date_completed)
      is distinct from (o.photo_link,o.spec,o.caliper,o.av_note,o.pick_note,o.match,o.loc_match_qty,o.date_completed)
  )
  update public.ph_soc_master s
  set photo_link=n.photo_link,photo_name=n.photo_name,photo_url=n.photo_url,photos=n.photos,
    dock_photo_link=case when n.photo_link is null then s.dock_photo_link else n.photo_link end,
    dock_photo_name=case when n.photo_link is null then s.dock_photo_name else n.photo_name end,
    dock_spec=case when n.photo_link is null then s.dock_spec else n.spec end,
    dock_caliper=case when n.photo_link is null then s.dock_caliper else n.caliper end,
    av_note=n.av_note,pick_note=n.pick_note,match=n.match,loc_match_qty=n.loc_match_qty,
    date_completed=case when upper(btrim(coalesce(s.suspend,'')))='SUSPEND' or n.photo_link is null
      then s.date_completed else n.date_completed end
  from changed_drive_evidence n where s.itemcode=n.itemcode and s.locationcode=n.locationcode
    and coalesce(s.lotcode,'')=coalesce(n.lotcode,'') and nullif(btrim(s.lotcode),'') is not null
    and (nullif(btrim(s.priority),'') is null or s.priority=n.priority)
    and not exists(select 1 from public.ph_master_inventory other
      where other.itemcode=n.itemcode and other.locationcode=n.locationcode and other.lotcode=n.lotcode
        and other.unique_id<>n.unique_id and (nullif(btrim(s.priority),'') is null or other.priority=s.priority))
    and n.locationcode!~'^0+[.]0+[.]111$'
    and (s.photo_link,s.dock_spec,s.dock_caliper,s.av_note,s.pick_note,s.match,s.loc_match_qty,s.date_completed)
      is distinct from (n.photo_link,n.spec,n.caliper,n.av_note,n.pick_note,n.match,n.loc_match_qty,n.date_completed);
  return null;
end
$publish$;
commit;

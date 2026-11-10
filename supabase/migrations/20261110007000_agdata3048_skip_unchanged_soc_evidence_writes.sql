begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Keep existing source eligibility, including the exact lot and priority.
-- Skip row writes when preserved Dock evidence makes the effective SET a no-op.
do $soc_delta$
declare
  definition text := pg_get_functiondef('private.publish_drive_evidence_to_soc_v23142()'::regprocedure);
  anchor text := $prior$      is distinct from (n.photo_link,n.spec,n.caliper,n.av_note,n.pick_note,n.match,n.loc_match_qty,n.date_completed);$prior$;
begin
  if cardinality(string_to_array(definition,anchor))<>2
    or strpos(definition,'with changed_drive_evidence as materialized')=0 then
    raise exception 'ERP_DRIVE_SOC_EFFECTIVE_EVIDENCE_ANCHOR_MISSING';
  end if;
  execute replace(definition,anchor,left(anchor,-1)||$delta$
    and (s.photo_link,s.photo_name,s.photo_url,s.photos,s.dock_photo_link,s.dock_photo_name,
      s.dock_spec,s.dock_caliper,s.av_note,s.pick_note,s.match,s.loc_match_qty,s.date_completed)
      is distinct from (n.photo_link,n.photo_name,n.photo_url,n.photos,coalesce(n.photo_link,s.dock_photo_link),
        case when n.photo_link is null then s.dock_photo_name else n.photo_name end,
        case when n.photo_link is null then s.dock_spec else n.spec end,
        case when n.photo_link is null then s.dock_caliper else n.caliper end,
        n.av_note,n.pick_note,n.match,n.loc_match_qty,
        case when upper(btrim(coalesce(s.suspend,'')))='SUSPEND' or n.photo_link is null
          then s.date_completed else n.date_completed end);$delta$);
end
$soc_delta$;

commit;

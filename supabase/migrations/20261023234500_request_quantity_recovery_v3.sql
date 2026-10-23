begin;

do $repair$
begin
  if exists (
    with corrections(unique_id,expected_qty) as (values
      ('REQ-mvlgbfl7p8r8zxrj97j','1'::text),
      ('REQ-mvlg4t85vlzf7053pv','1'::text),
      ('REQ-mvlfib5eqwa3typzcqq','1'::text),
      ('REQ-mvlfib5evawvlvvx09','1'::text),
      ('REQ-mvlex5bay7ngnehzi7','1'::text),
      ('REQ-mvlbp5hkkk58akaubms','10'::text),
      ('REQ-mvk1xgv2ty9fttuqj2','4'::text)
    )
    select 1
    from corrections
    join public.ph_active_request active using(unique_id)
    where lower(btrim(coalesce(active.req_status,'')))='pending'
      and coalesce(active.req_archived,false)=false
      and active.date_completed is null
      and active.req_qty is distinct from corrections.expected_qty
  ) then
    with corrections(unique_id,itemcode,locationcode,expected_qty) as (values
      ('REQ-mvlgbfl7p8r8zxrj97j','009199.013.1','D.09.013','1'::text),
      ('REQ-mvlg4t85vlzf7053pv','009501.013.1','D.09.044','1'::text),
      ('REQ-mvlfib5eqwa3typzcqq','001711.030.1','D.26.000','1'::text),
      ('REQ-mvlfib5evawvlvvx09','001711.070.1','F.05.000','1'::text),
      ('REQ-mvlex5bay7ngnehzi7','001884.011.1','E.10.000','1'::text),
      ('REQ-mvlbp5hkkk58akaubms','003139.250.1','A.08.000','10'::text),
      ('REQ-mvk1xgv2ty9fttuqj2','008280.150.1','C.05.000','4'::text)
    )
    update public.ph_active_request active set
      req_qty=corrections.expected_qty,
      row_version=coalesce(active.row_version,0)+1,
      updated_at=clock_timestamp()
    from corrections
    where active.unique_id=corrections.unique_id
      and active.itemcode=corrections.itemcode
      and upper(btrim(active.locationcode))=upper(corrections.locationcode)
      and lower(btrim(coalesce(active.req_status,'')))='pending'
      and coalesce(active.req_archived,false)=false
      and active.date_completed is null
      and active.req_qty is distinct from corrections.expected_qty
      and not exists (
        select 1 from public.ph_request_history history
        where history.unique_id=active.unique_id
          and (coalesce(history.req_archived,false) or history.date_completed is not null
            or lower(btrim(coalesce(history.req_status,''))) in
              ('complete','completed','done','closed','archived','cancelled','canceled','removed'))
      );
  end if;
end
$repair$;

do $verify$
declare
  invalid text;
begin
  if exists (
    select 1 from public.ph_active_request
    where unique_id in ('REQ-mvlgbfl7p8r8zxrj97j','REQ-mvlg4t85vlzf7053pv','REQ-mvlfib5eqwa3typzcqq',
      'REQ-mvlfib5evawvlvvx09','REQ-mvlex5bay7ngnehzi7','REQ-mvlbp5hkkk58akaubms','REQ-mvk1xgv2ty9fttuqj2')
  ) then
    with corrections(unique_id,itemcode,locationcode,expected_qty) as (values
      ('REQ-mvlgbfl7p8r8zxrj97j','009199.013.1','D.09.013','1'::text),
      ('REQ-mvlg4t85vlzf7053pv','009501.013.1','D.09.044','1'::text),
      ('REQ-mvlfib5eqwa3typzcqq','001711.030.1','D.26.000','1'::text),
      ('REQ-mvlfib5evawvlvvx09','001711.070.1','F.05.000','1'::text),
      ('REQ-mvlex5bay7ngnehzi7','001884.011.1','E.10.000','1'::text),
      ('REQ-mvlbp5hkkk58akaubms','003139.250.1','A.08.000','10'::text),
      ('REQ-mvk1xgv2ty9fttuqj2','008280.150.1','C.05.000','4'::text)
    )
    select string_agg(corrections.unique_id,',' order by corrections.unique_id)
    into invalid
    from corrections
    left join public.ph_active_request active
      on active.unique_id=corrections.unique_id
      and active.itemcode=corrections.itemcode
      and upper(btrim(active.locationcode))=upper(corrections.locationcode)
    where not coalesce((
      active.req_qty=corrections.expected_qty
      and lower(btrim(coalesce(active.req_status,'')))='pending'
      and coalesce(active.req_archived,false)=false
      and active.date_completed is null
    ),false) and not exists (
      select 1 from public.ph_request_history history
      where history.unique_id=corrections.unique_id
        and (coalesce(history.req_archived,false) or history.date_completed is not null
          or lower(btrim(coalesce(history.req_status,''))) in
            ('complete','completed','done','closed','archived','cancelled','canceled','removed'))
    );
    if invalid is not null then raise exception 'REQUEST_QUANTITY_RECOVERY_INCOMPLETE: %',invalid; end if;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.ph_active_request'::regclass
      and tgname='app_dataset_revision_updated' and tgenabled='O'
  ) then
    raise exception 'ACTIVE_REQUEST_UPDATE_REVISION_TRIGGER_MISSING';
  end if;
end
$verify$;

commit;

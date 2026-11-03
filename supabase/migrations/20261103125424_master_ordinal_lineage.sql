BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '15s';

-- Both fenced publishers build the same row map. Keep their independent
-- eligibility rules (including pending designations and priority splits).
DO $patch$
DECLARE
  target regprocedure;
  body text;
  start_at integer;
  stop_at integer;
  old_guard text := $guard$  if exists(select 1 from pg_temp.ph_master_bulk_map_v1 where candidate_count > 1) then
    raise exception using errcode='PT409', message = 'BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS';
  end if;
  if exists(select 1 from pg_temp.ph_master_bulk_map_v1 group by canonical_unique_id
    having canonical_unique_id is not null and count(*) > 1) then
    raise exception using errcode='PT409', message = 'BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS';
  end if;$guard$;
  map_sql text := $map$
  select distinct s.row_number, c.canonical_unique_id,
    coalesce(prior.source_unique_id = s.unique_id,false) as prior_match,
    (m.priority is not distinct from s.priority) as priority_match,
    greatest(m.date_completed,m.photo_date,m.av_rule_bundle_updated_at) as evaluation_at,
    private.manager_report_safe_numeric_v1(s.ptronhand) as incoming_on_hand,
    s.unique_id as source_unique_id
  from candidates c
  join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
  join public.ph_master_inventory m on m.unique_id=c.canonical_unique_id
  left join app_sync_private.ph_master_bulk_import_source_v1 prior on prior.canonical_unique_id=m.unique_id
  where s.unique_id<>m.unique_id and not exists (
    select 1 from pg_temp.ph_master_bulk_stage_v1 exact_row where exact_row.unique_id=m.unique_id
  );

  create temp table ph_master_bulk_map_v1 on commit drop as
  select s.row_number,s.unique_id as source_unique_id,m.unique_id as canonical_unique_id,
    case when m.unique_id is null then 0 else 1 end as candidate_count
  from pg_temp.ph_master_bulk_stage_v1 s left join public.ph_master_inventory m on m.unique_id=s.unique_id;
  create unique index ph_master_bulk_map_v1_row_idx on pg_temp.ph_master_bulk_map_v1(row_number);
  create unique index ph_master_bulk_map_v1_canonical_idx on pg_temp.ph_master_bulk_map_v1(canonical_unique_id);

  -- A canonical ID may be proposed by several physical rows. Award one
  -- ordinal at a time and let losing rows try their remaining eligible IDs.
  loop
    with available as (
      select e.* from pg_temp.ph_master_ordinal_edges e
      join pg_temp.ph_master_bulk_map_v1 s using(row_number)
      where s.canonical_unique_id is null and not exists (
        select 1 from pg_temp.ph_master_bulk_map_v1 used where used.canonical_unique_id=e.canonical_unique_id
      )
    ), proposals as (
      select a.*,row_number() over(partition by row_number order by prior_match desc,
        priority_match desc,evaluation_at desc nulls last,canonical_unique_id) as preference
      from available a
    ), winners as (
      select p.*,row_number() over(partition by canonical_unique_id order by prior_match desc,
        priority_match desc,incoming_on_hand desc nulls last,source_unique_id,row_number) as ordinal
      from proposals p where preference=1
    )
    update pg_temp.ph_master_bulk_map_v1 as target set canonical_unique_id=w.canonical_unique_id,candidate_count=1
    from winners w where w.ordinal=1 and target.row_number=w.row_number;
    exit when not found;
  end loop;
$map$;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure,
    'public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure
  ] LOOP
    body := pg_get_functiondef(target);
    IF strpos(body,'create temp table ph_master_ordinal_edges')>0 THEN CONTINUE; END IF;
    start_at := strpos(body,'  select s.row_number, s.unique_id as source_unique_id, min(c.canonical_unique_id)');
    stop_at := strpos(body,'  create index ph_master_bulk_map_v1_canonical_idx');
    IF start_at=0 OR stop_at<=start_at OR strpos(body,old_guard)=0 OR
       strpos(body,'create temp table ph_master_bulk_map_v1 on commit drop as')=0 THEN
      RAISE EXCEPTION 'MASTER_ORDINAL_PUBLISHER_CONTRACT_CHANGED';
    END IF;
    body := left(body,start_at-1)||map_sql||substr(body,stop_at+strpos(substr(body,stop_at),';'));
    body := replace(body,'create temp table ph_master_bulk_map_v1 on commit drop as'||chr(10)||'  with unresolved',
      'drop table if exists pg_temp.ph_master_ordinal_edges;'||chr(10)||'  create temp table ph_master_ordinal_edges on commit drop as'||chr(10)||'  with unresolved');
    body := replace(body,old_guard,'');
    -- ERP disappearance cannot delete an exact-row field evaluation or its lock.
    body := replace(body,'delete from public.ph_master_inventory live'||chr(10)||'    where not exists',
      $keep$delete from public.ph_master_inventory live
    where coalesce(live.date_completed,live.eval_task_completed_at,live.photo_date) is null
      and coalesce(nullif(btrim(live.photo_link),''),nullif(btrim(live.photo_name),''),
        nullif(btrim(live.photo_url),''),nullif(btrim(live.spec),''),nullif(btrim(live.caliper),''),
        nullif(btrim(live.av_note),''),nullif(btrim(live.pic_note),''),nullif(btrim(live.pick_note),''),
        nullif(btrim(live.sales_note),''),nullif(btrim(live.match),''),nullif(btrim(live.loc_match_qty),''),
        nullif(btrim(live.eval_task_status),''),nullif(btrim(live.eval_task_result_note),''),
        nullif(btrim(live.dock_spec),''),nullif(btrim(live.dock_caliper),''),nullif(btrim(live.dock_note),''),
        nullif(btrim(live.dock_photo_link),''),nullif(btrim(live.flyer_photo_link),'')) is null
      and nullif(live.photos,'[]'::jsonb) is null and live.loc_photo_match is null and live.loc_match_pct is null
      and not exists$keep$);
    IF target='public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure THEN
      -- Effective target IDs are now unique. Equal lineage or stable keys
      -- alone must never suppress a different physical row's upsert.
      body := replace(body,'                 or duplicate_s.lineage_key = s.lineage_key'||chr(10)||
        '                 or duplicate_s.stable_identity_key = s.stable_identity_key','');
      start_at := strpos(body,'  with duplicate_canonical as materialized (');
      stop_at := strpos(substr(body,start_at),'  if exists (');
      IF start_at=0 OR stop_at=0 THEN RAISE EXCEPTION 'MASTER_ORDINAL_DUPLICATE_CONTRACT_CHANGED'; END IF;
      body := left(body,start_at-1)||substr(body,start_at+stop_at-1);
    END IF;
    IF strpos(body,'create temp table ph_master_ordinal_edges')=0 OR strpos(body,'where coalesce(live.date_completed')=0
       OR strpos(body,'BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS')>0 THEN RAISE EXCEPTION 'MASTER_ORDINAL_PATCH_INCOMPLETE'; END IF;
    EXECUTE body;
  END LOOP;

  -- The worker imports ERP columns. Rewriting every manually entered AV
  -- note after the fenced import changes unrelated exact-row evaluations.
  target := 'public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure;
  body := pg_get_functiondef(target);
  IF strpos(body,'update public.ph_master_inventory'||chr(10)||'    set av_note=')>0 THEN
    body := replace(body,$note$    update public.ph_master_inventory
    set av_note=public.sanitize_av_note_without_spec_caliper(av_note)
    where av_note is distinct from public.sanitize_av_note_without_spec_caliper(av_note);$note$,'');
    IF strpos(body,'sanitize_av_note_without_spec_caliper')>0 THEN RAISE EXCEPTION 'MASTER_ORDINAL_AV_NOTE_CONTRACT_CHANGED'; END IF;
    EXECUTE body;
  END IF;
END
$patch$;
COMMIT;

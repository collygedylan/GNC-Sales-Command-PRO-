begin;
set local lock_timeout='1500ms';
set local statement_timeout='30s';

-- Only the existing certified Drive binding can expose a saved run-day.
-- The compiled stage is loaded and locked before the stage is marked committing.
create function private.erp_prior_run_day_cutoff_v3078(p_source_digest text)
returns timestamptz language plpgsql stable set search_path='' as $scope$
declare target_stage uuid; meta jsonb; started timestamptz; prior_day timestamptz; current_day timestamptz;
begin
  if p_source_digest is null or not private.has_drive_work_binding_v3078(true) then return null; end if;
  target_stage:=nullif(current_setting('agdata.erp.loaded_drive_stage',true),'')::uuid;
  select s.file_meta into meta from private.fast_erp_stage_runs_v1 s
    join private.erp_drive_final_certificates_v3078 c using(stage_id)
    join private.erp_drive_preparation_seals_v3078 seal using(stage_id)
    where s.stage_id=target_stage and s.dataset_key='drive_around' and s.stage_state in ('staging','committing')
      and c.ready and c.file_meta=s.file_meta and c.expires_at=s.expires_at
      and c.source_fingerprint=s.source_fingerprint and c.expected_rows=s.expected_rows
      and c.source_digest=seal.source_digest and seal.source_digest=p_source_digest;
  if not found then raise exception using errcode='55000',message='ERP_PRIOR_DAY_CONTEXT_INVALID'; end if;
  if nullif(meta->>'sync_run_id','') is null then return null; end if;
  if meta->>'sync_run_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='55000',message='ERP_PRIOR_DAY_CONTEXT_INVALID';
  end if;
  select r.started_at into started from private.erp_sync_jobs r where r.run_id=(meta->>'sync_run_id')::uuid;
  if not found or started is null then raise exception using errcode='55000',message='ERP_PRIOR_DAY_CONTEXT_INVALID'; end if;
  prior_day:=date_trunc('day',started at time zone 'America/Chicago') at time zone 'America/Chicago';
  current_day:=date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago';
  if prior_day>=current_day then return null; end if;
  return prior_day;
end
$scope$;
revoke all on function private.erp_prior_run_day_cutoff_v3078(text) from public,anon,authenticated,service_role;

-- Candidate IDs come from the existing exact eligible_missing_source relation.
-- The day window mirrors the existing protection predicates at the saved start.
create function private.assert_prior_run_day_prune_safe_v3078(p_candidates text[],p_prior_day timestamptz)
returns boolean language plpgsql stable set search_path='' as $guard$
declare current_day timestamptz; affected_uid text;
begin
  if p_prior_day is null or coalesce(cardinality(p_candidates),0)=0 then return true; end if;
  current_day:=date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago';
  if p_prior_day>=current_day then return true; end if;
  select hit.uid into affected_uid from (
    select e.canonical_unique_id as uid from app_sync_private.ph_master_inventory_app_edits e
      where e.canonical_unique_id=any(p_candidates) and e.updated_at>=p_prior_day and e.updated_at<current_day
    union all
    select e.canonical_unique_id from app_sync_private.inventory_live_overrides_v1 e
      where e.canonical_unique_id=any(p_candidates) and nullif(btrim(e.updated_by::text),'') is not null
        and e.updated_at>=p_prior_day and e.updated_at<current_day
    union all
    select e.source_unique_id from app_sync_private.inventory_location_evidence_v1 e
      where e.source_unique_id=any(p_candidates) and nullif(btrim(e.updated_by::text),'') is not null
        and e.updated_at>=p_prior_day and e.updated_at<current_day
    union all
    select e.source_unique_id from public.ph_productivity_history e
      where e.source_table in ('ph_master_inventory','public.ph_master_inventory') and e.source_unique_id=any(p_candidates)
        and e.completed_at>=p_prior_day and e.completed_at<current_day
  ) hit limit 1;
  if found then
    raise exception using errcode='55000',message='ERP_PRIOR_RUN_DAY_PRUNE_REVIEW_REQUIRED',
      detail=jsonb_build_object('canonical_unique_id',affected_uid,'prior_day_start',p_prior_day,'current_day_start',current_day)::text;
  end if;
  return true;
end
$guard$;
revoke all on function private.assert_prior_run_day_prune_safe_v3078(text[],timestamptz) from public,anon,authenticated,service_role;

-- Keep the installed candidate CTE and DELETE intact. The guard runs once over
-- exactly those candidates in the same statement and aborts the entire import.
do $wire$
declare definition text:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  cte_anchor text:=E'  ), deleted as (\n    delete from public.ph_master_inventory live using eligible_missing_source candidate\n    where live.unique_id=candidate.unique_id and live.ctid=candidate.physical_tid';
  replacement text:=$sql$  ), prior_run_day_scope_v3078 as materialized (
    select private.erp_prior_run_day_cutoff_v3078(p_source_digest) as prior_day
  ), prior_run_day_guard_v3078 as materialized (
    select case when scope.prior_day is null then true else
      private.assert_prior_run_day_prune_safe_v3078(array(select c.unique_id from eligible_missing_source c),scope.prior_day)
      end as ok from prior_run_day_scope_v3078 scope
  ), deleted as (
    delete from public.ph_master_inventory live using eligible_missing_source candidate,prior_run_day_guard_v3078 guard
    where guard.ok and live.unique_id=candidate.unique_id and live.ctid=candidate.physical_tid$sql$;
begin
  if cardinality(string_to_array(definition,cte_anchor))<>2
    or strpos(definition,'date_trunc(''day'',statement_timestamp() at time zone ''America/Chicago'') at time zone ''America/Chicago''')=0
    or to_regprocedure('private.has_drive_work_binding_v3078(boolean)') is null then
    raise exception 'ERP_PRIOR_DAY_PRUNE_OWNER_CHANGED';
  end if;
  execute replace(definition,cte_anchor,replacement);
end
$wire$;
commit;

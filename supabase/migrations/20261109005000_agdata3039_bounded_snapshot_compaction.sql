begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table if not exists private.history_delta_receipts_v3039 (
  id bigint generated always as identity primary key,
  run_id uuid,
  relation_id regclass not null,
  itemcode text not null,
  rows_removed bigint not null,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(run_id,relation_id,itemcode)
);
revoke all on private.history_delta_receipts_v3039 from public,anon,authenticated,service_role;

create or replace function private.assert_snapshot_archive_writable_v3039(p_relation regclass)
returns void language plpgsql security definer set search_path='' as $function$
declare blockers jsonb;
begin
  perform private.snapshot_read_relation_v3039(p_relation);
  if session_user not in('postgres','supabase_admin') then
    raise exception 'HISTORY_DIRECT_MAINTENANCE_SESSION_REQUIRED' using errcode='42501';
  end if;
  if not public.snapshot_archive_policy_supported_v3039(p_relation) then
    raise exception 'HISTORY_SNAPSHOT_ROW_SCOPE_UNSUPPORTED' using errcode='55000';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('history-delta-maintenance-v3039',0)) then
    raise exception 'HISTORY_MAINTENANCE_BUSY' using errcode='55P03';
  end if;
  blockers:=private.snapshot_delta_reader_blockers_v3039(p_relation);
  if jsonb_array_length(blockers)>0 then
    raise exception 'HISTORY_UNMIGRATED_SNAPSHOT_READERS' using errcode='55000',detail=blockers::text;
  end if;
end
$function$;

create or replace function private.stage_snapshot_delta_item_v3039(p_relation regclass,p_itemcode text)
returns void language plpgsql security definer set search_path='' as $function$
begin
  perform private.assert_snapshot_archive_writable_v3039(p_relation);
  execute format('select unique_id from %s where itemcode=$1 for update',p_relation) using p_itemcode;
  drop table if exists pg_temp.history_delta_work_v3039;
  execute format('create temporary table history_delta_work_v3039 on commit drop as
    with plan as materialized (select * from private.snapshot_delta_plan_v3039($1,$2)),
    candidates as materialized (select plan.observation_id,plan.retained_id
      from plan join %s physical on physical.unique_id=plan.observation_id
      where plan.observation_id<>plan.retained_id and to_jsonb(physical)=plan.payload),
    required as (select observation_id from candidates union select retained_id from candidates)
    select plan.* from plan join required using(observation_id)',p_relation) using p_relation,p_itemcode;
  create unique index on history_delta_work_v3039(observation_id);
end
$function$;

create or replace function private.snapshot_state_digest_v3039(p_state jsonb)
returns bytea language sql immutable strict set search_path='' as $function$
  select sha256(convert_to(p_state::text,'UTF8'))
$function$;

-- The only two callers supply fixed queries over a locked work table or an
-- staged INSERT transition table. State and provenance are written in the same tx.
create or replace function private.capture_snapshot_archive_v3039(p_relation regclass,p_source_sql text)
returns void language plpgsql security definer set search_path='' as $function$
declare unseen_source text; digest_collision boolean;
begin
  unseen_source:=format('select input.* from (%s) input
    where input.observed_on is not null and nullif(input.file_id,'''') is not null
      and not exists(select 1 from private.history_snapshot_coverage_v3039 coverage
        where coverage.relation_id=$1 and coverage.observation_id=input.observation_id)',p_source_sql);
  execute format('insert into private.history_snapshot_states_v3039(relation_id,state_digest,business_state)
    select distinct $1,private.snapshot_state_digest_v3039(input.business_state),input.business_state
    from (%s) input on conflict do nothing',unseen_source) using p_relation;
  execute format('select exists(select 1 from (%s) input join private.history_snapshot_states_v3039 state
    on state.relation_id=$1 and state.state_digest=private.snapshot_state_digest_v3039(input.business_state)
    where state.business_state is distinct from input.business_state)',unseen_source)
    into digest_collision using p_relation;
  if digest_collision then raise exception 'HISTORY_SNAPSHOT_STATE_DIGEST_COLLISION'; end if;
  execute format('insert into private.history_snapshot_coverage_v3039(relation_id,observation_id,retained_id,
    itemcode,file_id,observed_on,state_digest,provenance)
    select $1,input.observation_id,input.retained_id,input.itemcode,input.file_id,input.observed_on,
      private.snapshot_state_digest_v3039(input.business_state),input.provenance from (%s) input
    on conflict(relation_id,observation_id) do nothing',unseen_source) using p_relation;
end
$function$;

create or replace function private.write_snapshot_delta_coverage_v3039(p_relation regclass)
returns void language plpgsql security definer set search_path='' as $function$
begin
  perform private.capture_snapshot_archive_v3039(p_relation,'select * from pg_temp.history_delta_work_v3039');
  update private.history_snapshot_coverage_v3039 coverage set retained_id=plan.retained_id
    from pg_temp.history_delta_work_v3039 plan where coverage.relation_id=p_relation
      and coverage.observation_id=plan.observation_id and plan.observation_id<>plan.retained_id
      and coverage.retained_id is distinct from plan.retained_id;
end
$function$;

create or replace function private.delete_verified_snapshot_duplicates_v3039(p_relation regclass)
returns bigint language plpgsql security definer set search_path='' as $function$
declare removed bigint; mismatches bigint; expected_rows bigint; actual_rows bigint;
begin
  execute format('delete from %s physical using pg_temp.history_delta_work_v3039 plan
    where physical.unique_id=plan.observation_id and plan.observation_id<>plan.retained_id
      and to_jsonb(physical)=plan.payload',p_relation);
  get diagnostics removed=row_count;
  execute format('select count(*) from %s restored join pg_temp.history_delta_work_v3039 plan
    on restored.unique_id=plan.observation_id where to_jsonb(restored) is distinct from plan.payload',
    private.snapshot_read_relation_v3039(p_relation)) into mismatches;
  select count(*) into expected_rows from pg_temp.history_delta_work_v3039;
  execute format('select count(*) from %s restored join pg_temp.history_delta_work_v3039 plan
    on restored.unique_id=plan.observation_id',private.snapshot_read_relation_v3039(p_relation)) into actual_rows;
  if mismatches<>0 or expected_rows<>actual_rows then
    raise exception 'HISTORY_COVERAGE_RECONSTRUCTION_FAILED' using errcode='55000';
  end if;
  return removed;
end
$function$;

create or replace function private.compact_snapshot_item_v3039(p_relation regclass,p_itemcode text,p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' set lock_timeout='1s' as $function$
declare report jsonb; removed bigint; run_id_value uuid;
begin
  run_id_value:=nullif(current_setting('agdata.history_maintenance_run_id',true),'')::uuid;
  if p_apply is true and run_id_value is not null then
    select receipt into report from private.history_delta_receipts_v3039
      where run_id=run_id_value and relation_id=p_relation and itemcode=p_itemcode;
    if report is not null then return report; end if;
  end if;
  report:=private.snapshot_delta_report_v3039(p_relation,p_itemcode);
  if p_apply is not true then return report||jsonb_build_object('status','dry_run'); end if;
  perform private.stage_snapshot_delta_item_v3039(p_relation,p_itemcode);
  perform private.write_snapshot_delta_coverage_v3039(p_relation);
  removed:=private.delete_verified_snapshot_duplicates_v3039(p_relation);
  report:=report||jsonb_build_object('status','committed_in_current_transaction','rows_removed',removed,
    'logical_observations_preserved',true,'vacuum_required',removed>0);
  insert into private.history_delta_receipts_v3039(run_id,relation_id,itemcode,rows_removed,receipt)
    values(run_id_value,p_relation,p_itemcode,removed,report);
  return report;
end
$function$;

revoke all on function private.assert_snapshot_archive_writable_v3039(regclass) from public,anon,authenticated,service_role;
revoke all on function private.snapshot_state_digest_v3039(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.capture_snapshot_archive_v3039(regclass,text) from public,anon,authenticated,service_role;
revoke all on function private.stage_snapshot_delta_item_v3039(regclass,text) from public,anon,authenticated,service_role;
revoke all on function private.write_snapshot_delta_coverage_v3039(regclass) from public,anon,authenticated,service_role;
revoke all on function private.delete_verified_snapshot_duplicates_v3039(regclass) from public,anon,authenticated,service_role;
revoke all on function private.compact_snapshot_item_v3039(regclass,text,boolean) from public,anon,authenticated,service_role;
commit;

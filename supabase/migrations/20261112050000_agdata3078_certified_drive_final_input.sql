begin;
set local lock_timeout='1500ms';
set local statement_timeout='30s';

alter table private.fast_erp_stage_runs_v1 add column drive_input_epoch_v3078 uuid;
create unlogged table private.erp_drive_final_certificates_v3078 (
  stage_id uuid primary key references private.erp_drive_compiled_headers_v3078(stage_id) on delete cascade,
  input_epoch uuid not null,source_fingerprint text not null,expected_rows integer not null,
  checkpoint_hash text not null,source_digest text not null,file_meta jsonb not null,expires_at timestamptz not null,
  ready boolean not null default false
);
alter table private.erp_drive_final_certificates_v3078 enable row level security;
revoke all on private.erp_drive_final_certificates_v3078 from public,anon,authenticated,service_role;

-- The existing per-stage row serializes source changes with proof issuance
-- and consumption, even before a certificate exists. A new token changes
-- the parent row version as well, protecting repeatable-read callers.
create function private.advance_drive_input_epoch_v3078(p_stages uuid[])
returns void language plpgsql set search_path='' as $epoch$
declare s uuid;
begin
  for s in select stage_id from private.fast_erp_stage_runs_v1
    where dataset_key='drive_around' and stage_state='staging' and (p_stages is null or stage_id=any(p_stages))
    order by stage_id for update nowait loop
    update private.fast_erp_stage_runs_v1 set drive_input_epoch_v3078=gen_random_uuid() where stage_id=s;
  end loop;
end $epoch$;
revoke all on function private.advance_drive_input_epoch_v3078(uuid[]) from public,anon,authenticated,service_role;

create function private.observe_drive_input_changes_v3078()
returns trigger language plpgsql set search_path='' as $changed$
declare touched uuid[];
begin
  if tg_op='TRUNCATE' then
    perform private.advance_drive_input_epoch_v3078(null);
    return null;
  elsif tg_op='UPDATE' then
    select array_agg(stage_id) into touched from (select stage_id from old_input union select stage_id from new_input) ids;
  elsif tg_op='INSERT' then select array_agg(distinct stage_id) into touched from new_input;
  else select array_agg(distinct stage_id) into touched from old_input;
  end if;
  if touched is not null then perform private.advance_drive_input_epoch_v3078(touched); end if;
  return null;
end $changed$;
revoke all on function private.observe_drive_input_changes_v3078() from public,anon,authenticated,service_role;

do $inputs$
declare rel text; op text; streams text;
begin
  foreach rel in array array['fast_erp_stage_rows_v1','erp_drive_publication_parts_v3042','erp_drive_typed_rows_v3077',
    'erp_drive_typed_parts_v3077','erp_drive_preparation_seals_v3078'] loop
    foreach op in array array['insert','update','delete','truncate'] loop
      streams:=case op when 'insert' then 'referencing new table as new_input' when 'delete' then 'referencing old table as old_input'
        when 'update' then 'referencing old table as old_input new table as new_input' else '' end;
      execute format('create trigger %I after %s on private.%I %s for each statement execute function private.observe_drive_input_changes_v3078()',
        'drive_input_'||op||'_v3078',op,rel,streams);
      execute format('alter table private.%I enable always trigger %I',rel,'drive_input_'||op||'_v3078');
    end loop;
  end loop;
  foreach rel in array array['erp_drive_compiled_rows_v3078','erp_drive_compiled_cohorts_v3078'] loop
    execute format('create trigger drive_input_truncate_v3078 after truncate on private.%I
      for each statement execute function private.observe_drive_input_changes_v3078()',rel);
    execute format('alter table private.%I enable always trigger drive_input_truncate_v3078',rel);
  end loop;
end $inputs$;

-- Include both sides of a stage-key change; ordinary final overlays already
-- dirty their own disposable working stage, which disappears with its job.
create or replace function private.mark_drive_work_dirty_v3078()
returns trigger language plpgsql set search_path='' as $old$
declare touched uuid[];
begin
  if tg_op='UPDATE' then
    select array_agg(stage_id) into touched from (select stage_id from old_input union select stage_id from changed) ids;
  else select array_agg(distinct stage_id) into touched from changed;
  end if;
  if touched is null then return null; end if;
  perform private.advance_drive_input_epoch_v3078(touched);
  with locked as materialized (select h.stage_id from private.erp_drive_compiled_headers_v3078 h
    where h.stage_id=any(touched) and not h.dirty
      and (tg_op<>'INSERT' or h.ready or h.stage_id::text is distinct from current_setting('agdata.erp.compiling_drive_work',true))
    order by h.stage_id for update nowait)
  update private.erp_drive_compiled_headers_v3078 h set dirty=true from locked where h.stage_id=locked.stage_id;
  return null;
end $old$;
do $old_stages$
declare rel text; op text;
begin
  foreach rel in array array['erp_drive_compiled_rows_v3078','erp_drive_compiled_cohorts_v3078'] loop
    if not exists(select 1 from pg_trigger where tgrelid=format('private.%I',rel)::regclass and tgname='mark_dirty_update'
      and tgfoid='private.mark_drive_work_dirty_v3078()'::regprocedure and tgnewtable='changed' and tgoldtable is null)
      then raise exception 'ERP_COMPILED_DIRTY_TRIGGER_CHANGED'; end if;
    execute format('drop trigger mark_dirty_update on private.%I',rel);
    execute format('create trigger mark_dirty_update after update on private.%I
      referencing old table as old_input new table as changed for each statement execute function private.mark_drive_work_dirty_v3078()',rel);
    foreach op in array array['insert','update','delete'] loop
      execute format('alter table private.%I enable always trigger %I',rel,'mark_dirty_'||op);
    end loop;
  end loop;
end $old_stages$;

create function private.observe_drive_stage_identity_v3078()
returns trigger language plpgsql set search_path='' as $identity$
begin
  if new.drive_input_epoch_v3078 is distinct from old.drive_input_epoch_v3078 or
    (old.drive_input_epoch_v3078 is not null and (old.stage_id,old.stage_state,old.dataset_key,old.file_meta,old.source_fingerprint,
    old.expected_rows,old.staged_rows,old.expires_at) is distinct from (new.stage_id,new.stage_state,new.dataset_key,new.file_meta,
    new.source_fingerprint,new.expected_rows,new.staged_rows,new.expires_at)) then new.drive_input_epoch_v3078:=gen_random_uuid(); end if;
  return new;
end $identity$;
revoke all on function private.observe_drive_stage_identity_v3078() from public,anon,authenticated,service_role;
create trigger drive_certified_stage_identity_v3078 before update of stage_id,stage_state,dataset_key,file_meta,source_fingerprint,
  expected_rows,staged_rows,expires_at,drive_input_epoch_v3078 on private.fast_erp_stage_runs_v1 for each row
  execute function private.observe_drive_stage_identity_v3078();
alter table private.fast_erp_stage_runs_v1 enable always trigger drive_certified_stage_identity_v3078;

create function private.observe_drive_job_identity_v3078()
returns trigger language plpgsql set search_path='' as $identity$
begin
  perform private.advance_drive_input_epoch_v3078(array[old.stage_id,new.stage_id]);
  return new;
end $identity$;
revoke all on function private.observe_drive_job_identity_v3078() from public,anon,authenticated,service_role;
create trigger drive_certified_job_identity_v3078 after update of stage_id,prepared_rows,typed_prepared_rows,typed_source_fingerprint
  on private.erp_stage_publication_jobs_v3042 for each row when
  ((old.stage_id,old.prepared_rows,old.typed_prepared_rows,old.typed_source_fingerprint) is distinct from
   (new.stage_id,new.prepared_rows,new.typed_prepared_rows,new.typed_source_fingerprint))
  execute function private.observe_drive_job_identity_v3078();
alter table private.erp_stage_publication_jobs_v3042 enable always trigger drive_certified_job_identity_v3078;

create function private.lock_drive_final_input_v3078(p_stage uuid)
returns private.fast_erp_stage_runs_v1 language plpgsql set search_path='' as $lock$
declare s private.fast_erp_stage_runs_v1%rowtype; j private.erp_stage_publication_jobs_v3042%rowtype;
begin
  select * into strict j from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage for update nowait;
  select * into strict s from private.fast_erp_stage_runs_v1 where stage_id=p_stage for update nowait;
  if s.stage_state<>'staging' or s.dataset_key<>'drive_around' or s.expires_at<=clock_timestamp()
    or s.staged_rows<>s.expected_rows or j.prepared_rows<>s.expected_rows or j.typed_prepared_rows<>s.expected_rows
    or j.typed_source_fingerprint is distinct from s.source_fingerprint then raise exception 'ERP_FINAL_CERTIFICATE_STAGE_CHANGED'; end if;
  perform 1 from private.erp_drive_compiled_headers_v3078 h join private.erp_drive_preparation_seals_v3078 sealed using(stage_id)
    where h.stage_id=p_stage and not h.dirty and h.compiled_rows=h.expected_rows and h.expected_rows=s.expected_rows
      and h.source_fingerprint=s.source_fingerprint and (h.checkpoint_hash,h.source_digest,h.expected_rows,h.source_fingerprint)
        =(sealed.checkpoint_hash,sealed.source_digest,sealed.expected_rows,sealed.source_fingerprint) for update of h nowait;
  if not found then raise exception 'ERP_FINAL_CERTIFICATE_WORK_CHANGED'; end if;
  return s;
end $lock$;
revoke all on function private.lock_drive_final_input_v3078(uuid) from public,anon,authenticated,service_role;

create function private.match_drive_final_certificate_v3078(p_stage private.fast_erp_stage_runs_v1)
returns boolean language plpgsql set search_path='' as $match$
declare certified boolean;
begin
  select c.ready into certified from private.erp_drive_final_certificates_v3078 c
    join private.erp_drive_compiled_headers_v3078 h using(stage_id)
    where c.stage_id=p_stage.stage_id and c.input_epoch=p_stage.drive_input_epoch_v3078
      and c.file_meta=p_stage.file_meta and c.expires_at=p_stage.expires_at
      and (c.checkpoint_hash,c.source_digest,c.expected_rows,c.source_fingerprint)=(h.checkpoint_hash,h.source_digest,h.expected_rows,h.source_fingerprint)
      and (not c.ready or h.ready);
  if not found then raise exception 'ERP_FINAL_CERTIFICATE_MISSING_OR_INVALIDATED'; end if;
  return certified;
end $match$;
revoke all on function private.match_drive_final_certificate_v3078(private.fast_erp_stage_runs_v1) from public,anon,authenticated,service_role;

-- Enforce the actual proof on certificate DML itself: an ordinary owner
-- INSERT or UPDATE cannot advance or rewrite a certificate without it.
create function private.verify_drive_certificate_transition_v3078()
returns trigger language plpgsql set search_path='' as $verify$
declare s private.fast_erp_stage_runs_v1%rowtype;
begin
  s:=private.lock_drive_final_input_v3078(new.stage_id);
  if new.input_epoch is distinct from s.drive_input_epoch_v3078 or new.source_fingerprint<>s.source_fingerprint
    or new.expected_rows<>s.expected_rows or new.file_meta<>s.file_meta or new.expires_at<>s.expires_at
    or not exists(select 1 from private.erp_drive_compiled_headers_v3078 where stage_id=new.stage_id
      and checkpoint_hash=new.checkpoint_hash and source_digest=new.source_digest)
    then raise exception 'ERP_FINAL_CERTIFICATE_IDENTITY_CHANGED'; end if;
  if tg_op='INSERT' then
    if new.ready then raise exception 'ERP_FINAL_CERTIFICATE_PHASE_INVALID'; end if;
    perform private.assert_drive_typed_checkpoint_v3077(new.stage_id);
    if new.checkpoint_hash is distinct from private.drive_checkpoint_signature_v3078(new.stage_id)
      then raise exception 'ERP_DRIVE_PREPARATION_SEAL_CHANGED'; end if;
  else
    if old.ready or not new.ready or (to_jsonb(old)-'ready') is distinct from (to_jsonb(new)-'ready')
      then raise exception 'ERP_FINAL_CERTIFICATE_PHASE_INVALID'; end if;
    if (select (count(*),min(row_number),max(row_number)) is distinct from (s.expected_rows::bigint,1::bigint,s.expected_rows::bigint)
        from private.erp_drive_compiled_rows_v3078 where stage_id=new.stage_id) or exists(
      select erp_work_cohort from private.erp_drive_compiled_rows_v3078 where stage_id=new.stage_id
      except select erp_work_cohort from private.erp_drive_compiled_cohorts_v3078 where stage_id=new.stage_id)
      then raise exception 'ERP_COMPILED_ROW_COUNT'; end if;
  end if;
  return new;
end $verify$;
revoke all on function private.verify_drive_certificate_transition_v3078() from public,anon,authenticated,service_role;
create trigger verify_drive_certificate_transition_v3078 before insert or update on private.erp_drive_final_certificates_v3078
  for each row execute function private.verify_drive_certificate_transition_v3078();
alter table private.erp_drive_final_certificates_v3078 enable always trigger verify_drive_certificate_transition_v3078;

-- These operations have independent outer statement budgets. A legacy-ready
-- stage has no new certificate, so it starts with the full source/typed proof.
create function private.certify_drive_final_input_v3078(p_stage uuid)
returns boolean language plpgsql set search_path='' as $certify$
declare s private.fast_erp_stage_runs_v1%rowtype; input_epoch uuid;
begin
  s:=private.lock_drive_final_input_v3078(p_stage);
  if not exists(select 1 from private.erp_drive_final_certificates_v3078 where stage_id=p_stage) then
    update private.fast_erp_stage_runs_v1 set drive_input_epoch_v3078=gen_random_uuid() where stage_id=p_stage returning drive_input_epoch_v3078 into input_epoch;
    insert into private.erp_drive_final_certificates_v3078(stage_id,input_epoch,source_fingerprint,expected_rows,checkpoint_hash,source_digest,file_meta,expires_at)
      select p_stage,input_epoch,h.source_fingerprint,h.expected_rows,h.checkpoint_hash,h.source_digest,s.file_meta,s.expires_at
      from private.erp_drive_compiled_headers_v3078 h where h.stage_id=p_stage;
  else
    if private.match_drive_final_certificate_v3078(s) then return true; end if;
    update private.erp_drive_compiled_headers_v3078 set ready=true where stage_id=p_stage;
    update private.erp_drive_final_certificates_v3078 set ready=true where stage_id=p_stage;
  end if;
  update private.erp_stage_publication_jobs_v3042 set last_progress_at=clock_timestamp() where stage_id=p_stage;
  return false;
end $certify$;
revoke all on function private.certify_drive_final_input_v3078(uuid) from public,anon,authenticated,service_role;

do $route$
declare d text; entry text; a integer; b integer;
begin
  d:=pg_get_functiondef('private.prepare_drive_work_v3078(uuid)'::regprocedure);
  entry:=' if w.ready then return true; end if;';
  a:=strpos(d,E' else\n   perform private.assert_drive_typed_checkpoint_v3077(p_stage);');
  b:=strpos(d,E' end if;\n update private.erp_stage_publication_jobs_v3042 set last_progress_at');
  if cardinality(string_to_array(d,entry))<>2 or a=0 or b<=a then raise exception 'ERP_CERTIFICATION_PREPARE_OWNER_CHANGED'; end if;
  d:=overlay(d placing '' from a for b-a);
  execute replace(d,entry,' if w.compiled_rows=w.expected_rows then return private.certify_drive_final_input_v3078(p_stage); end if;');
  d:=pg_get_functiondef('private.load_drive_work_v3078(uuid)'::regprocedure);
  entry:=' perform private.assert_drive_typed_checkpoint_v3077(p_stage);';
  a:=strpos(d,' if (select count(*) from private.erp_drive_compiled_rows_v3078 where stage_id=p_stage)');
  b:=strpos(d,' select string_agg(format(''w.%I''');
  if cardinality(string_to_array(d,entry))<>2 or a=0 or b<=a then raise exception 'ERP_CERTIFICATION_FINAL_OWNER_CHANGED'; end if;
  d:=overlay(d placing '' from a for b-a);
  execute replace(d,entry,' if not private.match_drive_final_certificate_v3078(private.lock_drive_final_input_v3078(p_stage)) then
    raise exception ''ERP_FINAL_CERTIFICATE_NOT_READY''; end if;');
end $route$;
commit;

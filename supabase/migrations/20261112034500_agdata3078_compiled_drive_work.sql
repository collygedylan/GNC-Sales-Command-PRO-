begin;
set local statement_timeout='30s';
set local lock_timeout='1500ms';

-- Transactional scratch is prepared before the inventory fence. PostgreSQL
-- truncates all three UNLOGGED relations together after crash recovery; the
-- immutable typed/source checkpoints supply a complete rebuild on the next tick.
create unlogged table private.erp_drive_compiled_rows_v3078 as
select r.stage_id,r.row_number,r.raw_values,r.frozen_erp_on_hand_v3048,r.frozen_erp_review_v3048,r.frozen_erp_available_v3048,
 r.raw_item6_count,r.raw_item6_fields,r.field_keys,r.lineage_key,r.source_hash,(r.erp_row).*,0::integer erp_work_cohort
 from private.erp_drive_typed_rows_v3077 r with no data;
alter table private.erp_drive_compiled_rows_v3078 add primary key(stage_id,row_number),
 add foreign key(stage_id) references private.erp_stage_publication_jobs_v3042(stage_id) on delete cascade;
create unique index on private.erp_drive_compiled_rows_v3078(stage_id,unique_id);
create index on private.erp_drive_compiled_rows_v3078(stage_id,lineage_key);
create index on private.erp_drive_compiled_rows_v3078(stage_id,erp_work_cohort);
create unlogged table private.erp_drive_compiled_cohorts_v3078(
 stage_id uuid not null references private.erp_stage_publication_jobs_v3042(stage_id) on delete cascade,
 erp_work_cohort int,mask_hash text not null,raw_item6_fields text[] not null,field_keys text[] not null,complete_hold_tuple bool not null,
 primary key(stage_id,erp_work_cohort),unique(stage_id,mask_hash));
create unlogged table private.erp_drive_compiled_headers_v3078(
 stage_id uuid primary key references private.erp_stage_publication_jobs_v3042(stage_id) on delete cascade,
 source_fingerprint text not null,expected_rows int not null,source_digest text not null,checkpoint_hash text not null,
 compiled_rows integer not null default 0 check(compiled_rows between 0 and expected_rows),
 ready boolean not null default false,dirty boolean not null default false);
alter table private.erp_drive_compiled_rows_v3078 enable row level security;
alter table private.erp_drive_compiled_cohorts_v3078 enable row level security;
alter table private.erp_drive_compiled_headers_v3078 enable row level security;
revoke all on private.erp_drive_compiled_rows_v3078,private.erp_drive_compiled_cohorts_v3078,private.erp_drive_compiled_headers_v3078 from public,anon,authenticated,service_role;
create function private.mark_drive_work_dirty_v3078() returns trigger language plpgsql set search_path='' as $mark$
begin
  update private.erp_drive_compiled_headers_v3078 set dirty=true
  where not dirty and (tg_op<>'INSERT' or ready or stage_id::text is distinct from current_setting('agdata.erp.compiling_drive_work',true))
   and stage_id in(select c.stage_id from changed c);
  return null;
end $mark$;
revoke all on function private.mark_drive_work_dirty_v3078() from public,anon,authenticated,service_role;
do $triggers$
declare rel text; op text; trans text;
begin
 foreach rel in array array['erp_drive_compiled_rows_v3078','erp_drive_compiled_cohorts_v3078'] loop
   foreach op in array array['insert','update','delete'] loop
     trans:=case when op='delete' then 'old' else 'new' end;
     execute format('create trigger %I after %s on private.%I referencing %s table as changed
       for each statement execute function private.mark_drive_work_dirty_v3078()', 'mark_dirty_'||op,op,rel,trans);
   end loop;
 end loop;
end $triggers$;
create function private.assert_drive_work_shape_v3078() returns void language plpgsql stable set search_path='' as $shape$
begin
 if exists(
   select a.attname,a.atttypid,a.atttypmod,a.attcollation from pg_attribute a
   where a.attrelid='public.ph_master_inventory'::regclass and a.attnum>0 and not a.attisdropped
   except select a.attname,a.atttypid,a.atttypmod,a.attcollation from pg_attribute a
   where a.attrelid='private.erp_drive_compiled_rows_v3078'::regclass and a.attnum>0 and not a.attisdropped)
   or exists(
   select a.attname,a.atttypid,a.atttypmod,a.attcollation from pg_attribute a
   where a.attrelid='private.erp_drive_compiled_rows_v3078'::regclass and a.attnum>0 and not a.attisdropped
     and a.attname<>all(array['stage_id','row_number','raw_values','frozen_erp_on_hand_v3048','frozen_erp_review_v3048',
       'frozen_erp_available_v3048','raw_item6_count','raw_item6_fields','field_keys','lineage_key','source_hash','erp_work_cohort'])
   except select a.attname,a.atttypid,a.atttypmod,a.attcollation from pg_attribute a
   where a.attrelid='public.ph_master_inventory'::regclass and a.attnum>0 and not a.attisdropped)
   or not exists(select 1 from pg_class where oid='private.erp_drive_compiled_rows_v3078'::regclass
      and relkind='r' and relpersistence='u' and relrowsecurity and pg_get_userbyid(relowner)=current_user)
 then raise exception 'ERP_COMPILED_MASTER_SHAPE_CHANGED'; end if;
end $shape$;
revoke all on function private.assert_drive_work_shape_v3078() from public,anon,authenticated,service_role;

-- Select by the immutable stage ordinal. Mask hashes are only lookup keys;
-- exact array equality still decides membership even if hashes collide.
create function private.drive_work_mask_hash_v3078(p_raw text[],p_fields text[])
returns text language sql immutable strict set search_path='' as $hash$
 select encode(extensions.digest(convert_to(jsonb_build_array(p_raw,p_fields)::text,'UTF8'),'sha256'),'hex')
$hash$;
revoke all on function private.drive_work_mask_hash_v3078(text[],text[]) from public,anon,authenticated,service_role;

create function private.copy_drive_work_range_v3078(p_stage uuid,p_before integer,p_after integer)
returns void language plpgsql set search_path='' as $batch$
declare inserted integer; previous text:=current_setting('agdata.erp.compiling_drive_work',true);
begin
 if p_after<=p_before or p_after-p_before>250 then raise exception 'ERP_COMPILED_RANGE_INVALID'; end if;
 perform set_config('agdata.erp.compiling_drive_work',p_stage::text,true);
 insert into private.erp_drive_compiled_cohorts_v3078
   select p_stage,ordinal,private.drive_work_mask_hash_v3078(raw_item6_fields,field_keys),
     raw_item6_fields,field_keys,field_keys @> array['priority','holdstopcode','holdstopreason']
   from (select min(row_number) ordinal,raw_item6_fields,field_keys from private.erp_drive_typed_rows_v3077
     where stage_id=p_stage and row_number>p_before and row_number<=p_after group by raw_item6_fields,field_keys) masks
   on conflict(stage_id,mask_hash) do nothing;
 insert into private.erp_drive_compiled_rows_v3078
   select r.stage_id,r.row_number,r.raw_values,r.frozen_erp_on_hand_v3048,r.frozen_erp_review_v3048,r.frozen_erp_available_v3048,
     r.raw_item6_count,r.raw_item6_fields,r.field_keys,r.lineage_key,r.source_hash,expanded.*,c.erp_work_cohort
   from private.erp_drive_typed_rows_v3077 r join private.erp_drive_compiled_cohorts_v3078 c
     on c.stage_id=r.stage_id and c.mask_hash=private.drive_work_mask_hash_v3078(r.raw_item6_fields,r.field_keys)
     and c.raw_item6_fields=r.raw_item6_fields and c.field_keys=r.field_keys
   cross join lateral unnest(array[r.erp_row]) expanded
   where r.stage_id=p_stage and r.row_number>p_before and r.row_number<=p_after;
 get diagnostics inserted=row_count;
 if inserted<>p_after-p_before then raise exception 'ERP_COMPILED_RANGE_INCOMPLETE'; end if;
 perform set_config('agdata.erp.compiling_drive_work',coalesce(previous,''),true);
end $batch$;
revoke all on function private.copy_drive_work_range_v3078(uuid,integer,integer) from public,anon,authenticated,service_role;

create function private.prepare_drive_work_v3078(p_stage uuid) returns boolean language plpgsql set search_path='' as $prep$
declare s private.erp_drive_preparation_seals_v3078%rowtype; w private.erp_drive_compiled_headers_v3078%rowtype; next_row integer;
begin
 perform 1 from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage for update nowait;
 if not found then raise exception 'ERP_COMPILED_JOB_MISSING'; end if;
 select * into strict s from private.erp_drive_preparation_seals_v3078 where stage_id=p_stage;
 perform private.assert_drive_work_shape_v3078();
 if not exists(select 1 from private.fast_erp_stage_runs_v1 where stage_id=p_stage and dataset_key='drive_around'
    and stage_state='staging' and expires_at>clock_timestamp() and staged_rows=expected_rows and expected_rows=s.expected_rows
    and source_fingerprint=s.source_fingerprint) then raise exception 'ERP_COMPILED_STAGE_CHANGED'; end if;
 select * into w from private.erp_drive_compiled_headers_v3078 where stage_id=p_stage for update nowait;
 if not found then
   if s.checkpoint_hash is distinct from private.drive_checkpoint_signature_v3078(p_stage) then raise exception 'ERP_DRIVE_PREPARATION_SEAL_CHANGED'; end if;
   insert into private.erp_drive_compiled_headers_v3078(stage_id,source_fingerprint,expected_rows,source_digest,checkpoint_hash)
     values(p_stage,s.source_fingerprint,s.expected_rows,s.source_digest,s.checkpoint_hash) returning * into w;
 end if;
 if w.dirty or (w.checkpoint_hash,w.source_digest,w.expected_rows,w.source_fingerprint) is distinct from
   (s.checkpoint_hash,s.source_digest,s.expected_rows,s.source_fingerprint) then raise exception 'ERP_COMPILED_WORK_CHANGED'; end if;
 if w.ready then return true; end if;
 if w.compiled_rows<w.expected_rows then
   next_row:=least(w.compiled_rows+250,w.expected_rows);
   perform private.copy_drive_work_range_v3078(p_stage,w.compiled_rows,next_row);
   update private.erp_drive_compiled_headers_v3078 set compiled_rows=next_row where stage_id=p_stage;
 else
   perform private.assert_drive_typed_checkpoint_v3077(p_stage);
   if s.checkpoint_hash is distinct from private.drive_checkpoint_signature_v3078(p_stage) or
     (select (count(*),min(row_number),max(row_number)) is distinct from (w.expected_rows::bigint,1::bigint,w.expected_rows::bigint)
      from private.erp_drive_compiled_rows_v3078 where stage_id=p_stage) then raise exception 'ERP_COMPILED_ROW_COUNT'; end if;
   analyze private.erp_drive_compiled_rows_v3078 (stage_id,row_number,unique_id,lineage_key,erp_work_cohort);
   update private.erp_drive_compiled_headers_v3078 set ready=true where stage_id=p_stage;
 end if;
 update private.erp_stage_publication_jobs_v3042 set last_progress_at=clock_timestamp() where stage_id=p_stage;
 return false;
end $prep$;
revoke all on function private.prepare_drive_work_v3078(uuid) from public,anon,authenticated,service_role;

-- This is an automatically updatable alias of one fixed private relation. Its
-- literal stage predicate, WITH CHECK OPTION, owner and dependency checks bind
-- every write to one stage. The binding and dependent view drop on commit.
create function private.load_drive_work_v3078(p_stage uuid) returns boolean language plpgsql set search_path='' as $load$
declare fields text;
begin
 if not exists(select 1 from private.erp_drive_compiled_headers_v3078 where stage_id=p_stage) then return false; end if;
 if not exists(select 1 from private.erp_drive_compiled_headers_v3078 h join private.erp_drive_preparation_seals_v3078 s using(stage_id)
   where h.stage_id=p_stage and h.ready and not h.dirty and h.compiled_rows=h.expected_rows
   and (h.checkpoint_hash,h.source_digest,h.expected_rows,h.source_fingerprint)=(s.checkpoint_hash,s.source_digest,s.expected_rows,s.source_fingerprint))
   then raise exception 'ERP_COMPILED_NOT_READY'; end if;
 perform private.assert_drive_work_shape_v3078();
 perform private.assert_drive_typed_checkpoint_v3077(p_stage);
 create temp table agdata_drive_work_binding_v3078(stage_id uuid primary key) on commit drop;
 insert into pg_temp.agdata_drive_work_binding_v3078 values(p_stage);
 if (select count(*) from private.erp_drive_compiled_rows_v3078 where stage_id=p_stage)<>(select expected_rows from private.erp_drive_compiled_headers_v3078 where stage_id=p_stage) then raise exception 'ERP_COMPILED_ROW_COUNT'; end if;
 select string_agg(format('w.%I',attname),',' order by attnum) into fields from pg_attribute
 where attrelid='private.erp_drive_compiled_rows_v3078'::regclass and attnum>0 and not attisdropped and attname<>'stage_id';
 execute format('create temp view ph_master_bulk_stage_v1 with(security_invoker=true) as select %s
 from private.erp_drive_compiled_rows_v3078 w where w.stage_id=%L::uuid
 and exists(select 1 from pg_temp.agdata_drive_work_binding_v3078 b where b.stage_id=%L::uuid) with local check option',fields,p_stage,p_stage);
 create temp table ph_master_bulk_tuples_v3046 on commit drop as select raw_item6_fields,field_keys,complete_hold_tuple,erp_work_cohort
 from private.erp_drive_compiled_cohorts_v3078 where stage_id=p_stage;
 return true;
end $load$;
revoke all on function private.load_drive_work_v3078(uuid) from public,anon,authenticated,service_role;
create function private.has_drive_work_binding_v3078(p_require_live_seal boolean default true) returns boolean language plpgsql stable set search_path='' as $verify$
declare view_oid oid:=to_regclass('pg_temp.ph_master_bulk_stage_v1'); bind_oid oid:=to_regclass('pg_temp.agdata_drive_work_binding_v3078'); stage text:=current_setting('agdata.erp.loaded_drive_stage',true);
begin
 if view_oid is null or bind_oid is null then return false; end if;
 if (select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relpersistence='t' and pg_get_userbyid(relowner)=current_user
   and ((oid=bind_oid and relkind='r') or (oid=view_oid and relkind='v' and reloptions @> array['security_invoker=true'])))<>2 then return false; end if;
 if (select count(distinct d.refobjid) from pg_rewrite r join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=r.oid
   and d.refclassid='pg_class'::regclass where r.ev_class=view_oid and d.refobjid in(bind_oid,'private.erp_drive_compiled_rows_v3078'::regclass))<>2 then return false; end if;
 if exists(select 1 from pg_rewrite r join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=r.oid
   and d.refclassid='pg_class'::regclass where r.ev_class=view_oid and d.refobjid not in(bind_oid,view_oid,'private.erp_drive_compiled_rows_v3078'::regclass)) then return false; end if;
 if not p_require_live_seal then return true; end if;
 return exists(select 1 from pg_temp.agdata_drive_work_binding_v3078 b join private.erp_drive_compiled_headers_v3078 h using(stage_id)
    join private.erp_drive_preparation_seals_v3078 s using(stage_id) where b.stage_id::text=stage and h.ready
    and (s.checkpoint_hash,s.source_digest,s.source_fingerprint,s.expected_rows)=(h.checkpoint_hash,h.source_digest,h.source_fingerprint,h.expected_rows));
end $verify$;
revoke all on function private.has_drive_work_binding_v3078(boolean) from public,anon,authenticated,service_role;

create function private.drive_compiled_cohort_sql_v3078(p_sql text,p_digest text,p_tuple jsonb)
returns text language plpgsql stable set search_path='' as $cohort$
declare predicate constant text:='s.raw_item6_fields = $1 and s.field_keys = $2'; cohort integer;
begin
 if p_digest is null or not private.has_drive_work_binding_v3078() then return p_sql; end if;
 cohort:=(p_tuple->>'erp_work_cohort')::integer;
 if cohort is null or cardinality(string_to_array(p_sql,predicate))<>2 then raise exception 'ERP_COMPILED_COHORT_CHANGED'; end if;
 return replace(p_sql,predicate,format('s.erp_work_cohort = %s',cohort));
end $cohort$;
revoke all on function private.drive_compiled_cohort_sql_v3078(text,text,jsonb) from public,anon,authenticated,service_role;

create function private.drive_work_index_or_analyze_v3078(p_digest text,p_analyze boolean)
returns void language plpgsql set search_path='' as $index$
begin
 if (select relkind='v' from pg_class where oid=to_regclass('pg_temp.ph_master_bulk_stage_v1')) then
   if p_digest is null or not private.has_drive_work_binding_v3078() then raise exception 'ERP_COMPILED_BINDING_UNTRUSTED'; end if;
   return;
 end if;
 if p_analyze then analyze pg_temp.ph_master_bulk_stage_v1 (row_number, unique_id, raw_item6_fields, field_keys);
 else create index if not exists reclass_bulk_stage_lineage_idx on pg_temp.ph_master_bulk_stage_v1(lineage_key); end if;
end $index$;
revoke all on function private.drive_work_index_or_analyze_v3078(text,boolean) from public,anon,authenticated,service_role;

-- A direct raw import can follow another prepared call in the same SQL
-- transaction. Only retire the alias/binding created by the verified loader.
create function private.open_drive_decode_input_v3078(p_rows jsonb)
returns void language plpgsql set search_path='' as $raw$
begin
 if private.has_drive_work_binding_v3078(false) then
   drop view pg_temp.ph_master_bulk_stage_v1;
   drop table pg_temp.agdata_drive_work_binding_v3078;
 end if;
 if p_rows is not null then
   drop table if exists pg_temp.erp_drive_decode_input_v3078;
   create temp table erp_drive_decode_input_v3078 with(toast_tuple_target=8000) on commit drop as
     select value,ordinality from jsonb_array_elements(p_rows) with ordinality;
 elsif not exists(select 1 from pg_class where relnamespace=pg_my_temp_schema() and relname='erp_drive_decode_input_v3078'
   and relkind='r' and relpersistence='t' and pg_get_userbyid(relowner)=current_user) then
   raise exception 'ERP_DRIVE_DECODER_SOURCE_UNTRUSTED';
 end if;
end $raw$;
revoke all on function private.open_drive_decode_input_v3078(jsonb) from public,anon,authenticated,service_role;

do $raw_wire$
declare d text:=pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure);
 a integer:=strpos(d,'  if p_rows is not null then'); b integer:=strpos(d,'  if exists (');
begin
 if a=0 or b<=a or strpos(substring(d from a for b-a),'ERP_DRIVE_DECODER_SOURCE_UNTRUSTED')=0 then raise exception 'ERP_COMPILED_RAW_ENTRY_CHANGED'; end if;
 execute overlay(d placing '  perform private.open_drive_decode_input_v3078(p_rows);'||chr(10) from a for b-a);
end $raw_wire$;

do $wire$
declare d text; a text; b text;
begin
 d:=pg_get_functiondef('private.load_drive_preparation_seal_v3078(uuid)'::regprocedure);
 a:='  perform private.load_drive_typed_checkpoint_v3077(p_stage_id);';
 if cardinality(string_to_array(d,a))<>2 then raise exception 'ERP_COMPILED_LOAD_OWNER_CHANGED'; end if;
 execute replace(d,a,'  if not private.load_drive_work_v3078(p_stage_id) then'||chr(10)||a||chr(10)||'  end if;');
 d:=pg_get_functiondef('private.prepare_erp_publication_v3077(uuid)'::regprocedure);
 a:='  return private.seal_drive_preparation_v3078(p_stage_id);';
 if cardinality(string_to_array(d,a))<>2 then raise exception 'ERP_COMPILED_PREPARATION_OWNER_CHANGED'; end if;
 execute replace(d,a,'  if exists(select 1 from private.erp_drive_preparation_seals_v3078 where stage_id=p_stage_id)
    and not private.prepare_drive_work_v3078(p_stage_id) then return false; end if;'||chr(10)||a);
 d:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
 a:='  create index if not exists reclass_bulk_stage_lineage_idx on pg_temp.ph_master_bulk_stage_v1(lineage_key);';
 b:='  analyze pg_temp.ph_master_bulk_stage_v1 (row_number, unique_id, raw_item6_fields, field_keys);';
 if cardinality(string_to_array(d,a))<>2 or cardinality(string_to_array(d,b))<>2 then raise exception 'ERP_COMPILED_STAGE_STATS_CHANGED'; end if;
 d:=replace(replace(d,a,'  perform private.drive_work_index_or_analyze_v3078(loaded_payload_hash,false);'),
     b,'  perform private.drive_work_index_or_analyze_v3078(loaded_payload_hash,true);');
 a:='    select raw_item6_fields,field_keys,complete_hold_tuple'||chr(10)||'    from pg_temp.ph_master_bulk_tuples_v3046';
 b:='    execute sql_text into batch_';
 if cardinality(string_to_array(d,a))<>2 or cardinality(string_to_array(d,b))<>3 then raise exception 'ERP_COMPILED_COHORT_OWNER_CHANGED'; end if;
 d:=replace(d,a,'    select * from pg_temp.ph_master_bulk_tuples_v3046');
 execute replace(d,b,'    execute private.drive_compiled_cohort_sql_v3078(sql_text,loaded_payload_hash,to_jsonb(tuple_value)) into batch_');
end $wire$;
commit;

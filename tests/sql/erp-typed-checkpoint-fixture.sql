-- Caller supplies erp77_input(payload jsonb) for the verified workbook.
-- Run in a disposable PostgreSQL 17 transaction and roll back afterwards.
select set_config('request.jwt.claim.role','service_role',true);
select private.prepare_master_bulk_stage_v3046(payload) from erp77_input;
create temp table erp77_expected_typed as
select count(*) rows,md5(string_agg(md5(to_jsonb(s)::text),',' order by row_number)) hash
from pg_temp.ph_master_bulk_stage_v1 s;
insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
values('e3077000-0000-4000-8000-000000000071','drive_around','{"file_name":"ERP77-typed.xlsx"}',
  'erp77-typed-exact-fingerprint',9610,9610);
insert into private.erp_stage_publication_jobs_v3042(stage_id,prepared_rows)
values('e3077000-0000-4000-8000-000000000071',9610);
-- Legacy 1,500-row prepared parts decode in at most 1,000-row steps.
insert into private.erp_drive_publication_parts_v3042(stage_id,first_row,row_count,raw_bytes,body)
select 'e3077000-0000-4000-8000-000000000071',((ordinality-1)/1500)::integer*1500+1,
  count(*)::integer,sum(octet_length(value::text)+2),string_agg(value::text,',' order by ordinality)
from erp77_input cross join lateral jsonb_array_elements(payload) with ordinality group by 2;
create temp table erp77_original_parts as
select * from private.erp_drive_publication_parts_v3042 where stage_id='e3077000-0000-4000-8000-000000000071';
create temp table erp77_typed_timings(rows integer,ms numeric);

do $first$
declare stage uuid:='e3077000-0000-4000-8000-000000000071'; rejected boolean:=false; original text;
begin
  perform 1 from private.erp_stage_publication_jobs_v3042 where stage_id=stage for update;
  assert not private.prepare_drive_typed_part_v3077(stage);
  assert (select typed_prepared_rows=1000 from private.erp_stage_publication_jobs_v3042 where stage_id=stage);
  assert (select count(*)=1000 from private.erp_drive_typed_rows_v3077 where stage_id=stage);
  select body into original from erp77_original_parts where first_row=1;
  update private.erp_drive_publication_parts_v3042 set body=substr(jsonb_set(('['||body||']')::jsonb,
    '{1000,values,unique_id}',(select to_jsonb((erp_row).unique_id) from private.erp_drive_typed_rows_v3077
      where stage_id=stage and row_number=1))::text,2,length(jsonb_set(('['||body||']')::jsonb,
    '{1000,values,unique_id}',(select to_jsonb((erp_row).unique_id) from private.erp_drive_typed_rows_v3077
      where stage_id=stage and row_number=1))::text)-2) where stage_id=stage and first_row=1;
  begin perform private.prepare_drive_typed_part_v3077(stage);
  exception when unique_violation then rejected:=true; end;
  assert rejected,'cross-part duplicate physical UID must fail before progress';
  assert (select typed_prepared_rows=1000 from private.erp_stage_publication_jobs_v3042 where stage_id=stage);
  assert (select count(*)=1000 from private.erp_drive_typed_rows_v3077 where stage_id=stage);
  update private.erp_drive_publication_parts_v3042 set body=original where stage_id=stage and first_row=1;
end
$first$;

do $identity$
declare stage uuid:='e3077000-0000-4000-8000-000000000071'; rejected boolean;
begin
  update private.erp_stage_publication_jobs_v3042 set typed_source_fingerprint='wrong' where stage_id=stage;
  rejected:=false;
  begin perform private.prepare_drive_typed_part_v3077(stage);
  exception when others then rejected:=SQLERRM='ERP_TYPED_STAGE_IDENTITY_CHANGED'; end;
  assert rejected,'a checkpoint cannot transfer to a different source fingerprint';
  update private.erp_stage_publication_jobs_v3042 set typed_source_fingerprint='erp77-typed-exact-fingerprint' where stage_id=stage;
  update private.fast_erp_stage_runs_v1 set expires_at=clock_timestamp()-interval '1 second' where stage_id=stage;
  rejected:=false;
  begin perform private.prepare_drive_typed_part_v3077(stage);
  exception when others then rejected:=SQLERRM='ERP_TYPED_STAGE_IDENTITY_CHANGED'; end;
  assert rejected,'expired stages cannot advance';
  update private.fast_erp_stage_runs_v1 set expires_at=clock_timestamp()+interval '1 day' where stage_id=stage;
  rejected:=false;
  begin update private.erp_drive_typed_rows_v3077 set erp_row=jsonb_populate_record(erp_row,'{"priority":"unauthorized"}')
    where stage_id=stage and row_number=1;
  exception when check_violation then rejected:=true; end;
  assert rejected,'a checkpoint cannot cache a live app overlay';
  rejected:=false;
  begin update private.erp_drive_typed_rows_v3077 set source_hash=repeat('0',64) where stage_id=stage and row_number=1;
  exception when check_violation then rejected:=true; end;
  assert rejected,'cached raw values retain their canonical per-row hash';
end
$identity$;

do $resume$
declare stage uuid:='e3077000-0000-4000-8000-000000000071'; before_rows integer; after_rows integer;
  started timestamptz; ready boolean; prefix text;
begin
  select md5(string_agg(source_hash,',' order by row_number)) into prefix
    from private.erp_drive_typed_rows_v3077 where stage_id=stage;
  loop
    select typed_prepared_rows into before_rows from private.erp_stage_publication_jobs_v3042 where stage_id=stage;
    started:=clock_timestamp();
    ready:=private.prepare_drive_typed_part_v3077(stage);
    select typed_prepared_rows into after_rows from private.erp_stage_publication_jobs_v3042 where stage_id=stage;
    exit when ready;
    assert after_rows>before_rows and after_rows-before_rows<=1000;
    insert into erp77_typed_timings values(after_rows-before_rows,extract(epoch from(clock_timestamp()-started))*1000);
  end loop;
  assert prefix=(select md5(string_agg(source_hash,',' order by row_number))
    from private.erp_drive_typed_rows_v3077 where stage_id=stage and row_number<=1000),'resuming cannot rewrite a confirmed prefix';
  perform private.assert_drive_typed_checkpoint_v3077(stage);
  perform private.load_drive_typed_checkpoint_v3077(stage);
  assert (select hash from erp77_expected_typed)=
    (select md5(string_agg(md5(to_jsonb(s)::text),',' order by row_number)) from pg_temp.ph_master_bulk_stage_v1 s);
  perform private.load_drive_erp_publication_input_v3042(stage);
  assert current_setting('agdata.erp.loaded_drive_stage',true)=stage::text;
  assert (select source_digest from pg_temp.agdata_drive_publication_input_v3042)=
    (select encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex') from erp77_input),
    'final canonical payload digest must remain exact';
end
$resume$;

do $coherent_corruption$
declare stage uuid:='e3077000-0000-4000-8000-000000000071'; rejected boolean:=false;
begin
  begin
    update private.erp_drive_typed_rows_v3077 set
      raw_values=jsonb_set(raw_values,'{ptronhand}','"999999"'),
      erp_row=jsonb_populate_record(erp_row,'{"ptronhand":"999999"}'),
      frozen_erp_on_hand_v3048=999999,
      source_hash=private.ph_master_bulk_source_hash_v1(jsonb_set(raw_values,'{ptronhand}','"999999"'),raw_item6_fields),
      decoded_row_hash=private.drive_typed_metadata_hash_v3077(row_number,
        jsonb_set(raw_values,'{ptronhand}','"999999"'),999999,frozen_erp_review_v3048,frozen_erp_available_v3048,
        raw_item6_count,raw_item6_fields,field_keys,lineage_key,
        private.ph_master_bulk_source_hash_v1(jsonb_set(raw_values,'{ptronhand}','"999999"'),raw_item6_fields))
    where stage_id=stage and row_number=1;
    perform private.assert_drive_typed_checkpoint_v3077(stage);
  exception when others then rejected:=SQLERRM='ERP_TYPED_DECODED_ROWS_CHANGED';
  end;
  assert rejected,'coherent cached raw/typed/hash/stock edits cannot reuse an old source-part receipt';
  perform private.assert_drive_typed_checkpoint_v3077(stage);
end
$coherent_corruption$;

do $tamper$
declare stage uuid:='e3077000-0000-4000-8000-000000000071'; rejected boolean:=false;
begin
  update private.erp_drive_publication_parts_v3042 set body=substr(jsonb_set(('['||body||']')::jsonb,
    '{0,values,priority}','"ERP77-tampered"')::text,2,length(jsonb_set(('['||body||']')::jsonb,
    '{0,values,priority}','"ERP77-tampered"')::text)-2) where stage_id=stage and first_row=1;
  begin perform private.assert_drive_typed_checkpoint_v3077(stage);
  exception when others then rejected:=SQLERRM='ERP_TYPED_SOURCE_PART_CHANGED'; end;
  assert rejected,'a changed old source part cannot reuse cached typed rows';
  update private.erp_drive_publication_parts_v3042 p set body=o.body from erp77_original_parts o
    where p.stage_id=stage and o.stage_id=p.stage_id and o.first_row=p.first_row;
  perform private.assert_drive_typed_checkpoint_v3077(stage);
  rejected:=false;
  begin
    delete from private.erp_drive_typed_rows_v3077 where stage_id=stage and row_number=9610;
    perform private.assert_drive_typed_checkpoint_v3077(stage);
  exception when others then rejected:=SQLERRM='ERP_TYPED_STAGE_INCOMPLETE'; end;
  assert rejected,'a missing ordinal cannot hydrate a complete stage';
  assert not exists(select 1 from private.fast_erp_stage_runs_v1 where stage_id=stage and committed_result is not null);
end
$tamper$;
select jsonb_build_object('rows',(select count(*) from private.erp_drive_typed_rows_v3077
  where stage_id='e3077000-0000-4000-8000-000000000071'),'typedParity',true,
  'timings',(select jsonb_agg(to_jsonb(t)) from erp77_typed_timings t));

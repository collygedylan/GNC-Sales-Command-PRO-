-- Caller supplies erp77_input(payload jsonb) containing the actual workbook,
-- inside a disposable transaction. Every typed row is produced by the
-- installed canonical parser; no operational table is changed.
select private.prepare_master_bulk_stage_v3046(payload) from erp77_input;
create temp table erp77_whole_hash as
select count(*) rows,md5(string_agg(md5(to_jsonb(s)::text),',' order by row_number)) hash
from pg_temp.ph_master_bulk_stage_v1 s;
create temp table erp77_aggregate as select * from pg_temp.ph_master_bulk_stage_v1 with no data;
create unique index on erp77_aggregate(row_number);
create unique index on erp77_aggregate(unique_id);
create temp table erp77_parts as
select ((ordinality-1)/1000)::integer part,jsonb_agg(value order by ordinality) payload
from erp77_input cross join lateral jsonb_array_elements(payload) with ordinality group by 1;
create temp table erp77_part_timing(part integer,rows integer,ms numeric);

do $chunks$
declare chunk record; started timestamptz; columns text;
begin
  select string_agg(format('%I',attname),',' order by attnum) into columns from pg_attribute
  where attrelid='pg_temp.erp77_aggregate'::regclass and attnum>0 and not attisdropped and attname<>'row_number';
  for chunk in select * from erp77_parts order by part loop
    started:=clock_timestamp();
    perform private.prepare_master_bulk_stage_v3046(chunk.payload);
    execute format('insert into pg_temp.erp77_aggregate select row_number+%s,%s from pg_temp.ph_master_bulk_stage_v1',
      chunk.part*1000,columns);
    insert into erp77_part_timing select chunk.part,count(*),extract(epoch from(clock_timestamp()-started))*1000
    from pg_temp.ph_master_bulk_stage_v1;
  end loop;
end
$chunks$;

do $duplicate$
declare columns text; rejected boolean:=false;
begin
  select string_agg(format('%I',attname),',' order by attnum) into columns from pg_attribute
  where attrelid='pg_temp.erp77_aggregate'::regclass and attnum>0 and not attisdropped and attname<>'row_number';
  begin
    execute format('insert into pg_temp.erp77_aggregate select row_number+100000,%s from pg_temp.erp77_aggregate limit 1',columns);
  exception when unique_violation then rejected:=true;
  end;
  assert rejected,'duplicate physical UIDs across decoded parts must fail';
  assert (select rows=9610 from erp77_whole_hash);
  assert (select count(*)=9610 from erp77_aggregate);
  assert (select hash from erp77_whole_hash)=
    (select md5(string_agg(md5(to_jsonb(s)::text),',' order by row_number)) from erp77_aggregate s),
    'all typed source values, evidence inputs, physical IDs, raw fields, stock witnesses and hashes must match';
end
$duplicate$;
select jsonb_build_object('wholeRows',(select rows from erp77_whole_hash),
  'chunkRows',(select count(*) from erp77_aggregate),'allTypedMetadataEqual',true,
  'parts',(select jsonb_agg(to_jsonb(t)) from erp77_part_timing t));
